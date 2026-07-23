// Muse Machine — native macOS shell.
// A WKWebView window + a tiny embedded static file server (127.0.0.1:8123)
// serving the bundled web app, so ES modules and localStorage behave exactly
// like they do on a normal http origin.

import AppKit
import WebKit
import Network

// ---------- tiny static file server ----------

final class WebServer {
    static let port: UInt16 = 8123
    let root: URL
    private var listener: NWListener?

    init(root: URL) { self.root = root }

    func start() throws {
        let params = NWParameters.tcp
        // loopback only — the save API must never be reachable from the network
        params.requiredLocalEndpoint = NWEndpoint.hostPort(
            host: NWEndpoint.Host("127.0.0.1"),
            port: NWEndpoint.Port(rawValue: WebServer.port)!)
        let l = try NWListener(using: params)
        l.newConnectionHandler = { [weak self] conn in
            conn.start(queue: .global())
            self?.receive(conn, buffer: Data())
        }
        l.start(queue: .global())
        listener = l
    }

    private func receive(_ conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 1 << 22) { [weak self] data, _, done, err in
            guard let self else { conn.cancel(); return }
            var buf = buffer
            if let d = data { buf.append(d) }
            if let headerEnd = buf.range(of: Data("\r\n\r\n".utf8)) {
                let header = String(data: buf[..<headerEnd.lowerBound], encoding: .utf8) ?? ""
                var contentLength = 0
                for line in header.split(separator: "\r\n") where line.lowercased().hasPrefix("content-length:") {
                    contentLength = Int(line.split(separator: ":")[1].trimmingCharacters(in: .whitespaces)) ?? 0
                }
                let bodySoFar = buf.count - headerEnd.upperBound
                if bodySoFar >= contentLength {
                    let body = buf.subdata(in: headerEnd.upperBound..<(headerEnd.upperBound + contentLength))
                    self.route(conn, header: header, body: body)
                } else if err == nil && !done {
                    self.receive(conn, buffer: buf)
                } else { conn.cancel() }
            } else if err == nil && !done {
                self.receive(conn, buffer: buf)
            } else { conn.cancel() }
        }
    }

    private func route(_ conn: NWConnection, header: String, body: Data) {
        let firstLine = header.split(separator: "\r\n").first.map(String.init) ?? ""
        let parts = firstLine.split(separator: " ")
        let method = parts.first.map(String.init) ?? "GET"
        var path = parts.count > 1 ? String(parts[1]) : "/"
        if let q = path.firstIndex(of: "?") { path = String(path[..<q]) }

        switch (method, path) {
        case ("GET", "/api/savedir"):
            sendJSON(conn, ["path": SaveDir.current().path])
        case ("POST", "/api/choose-dir"):
            var chosen: String? = nil
            DispatchQueue.main.sync {
                NSApp.activate(ignoringOtherApps: true)
                let panel = NSOpenPanel()
                panel.canChooseDirectories = true
                panel.canChooseFiles = false
                panel.canCreateDirectories = true
                panel.prompt = "Use This Folder"
                panel.message = "Choose where Muse Machine saves your tracks"
                panel.directoryURL = SaveDir.current()
                if panel.runModal() == .OK, let url = panel.url {
                    SaveDir.set(url)
                    chosen = url.path
                }
            }
            sendJSON(conn, chosen != nil ? ["path": chosen!] : ["cancelled": "true"])
        case ("POST", "/api/save"):
            guard let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
                  let rawName = json["filename"] as? String,
                  let b64 = json["data"] as? String,
                  let audio = Data(base64Encoded: b64) else {
                sendJSON(conn, ["error": "bad request"], status: "400 Bad Request")
                return
            }
            let safeName = rawName.components(separatedBy: CharacterSet(charactersIn: "/\\:")).joined(separator: "-")
            let dir = SaveDir.current()
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let dest = dir.appendingPathComponent(safeName)
            do {
                try audio.write(to: dest)
                sendJSON(conn, ["path": dest.path])
            } catch {
                sendJSON(conn, ["error": error.localizedDescription], status: "500 Internal Server Error")
            }
        default:
            serveStatic(conn, path: path)
        }
    }

    private func sendJSON(_ conn: NWConnection, _ obj: [String: String], status: String = "200 OK") {
        let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8)
        let head = "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\nContent-Length: \(data.count)\r\nConnection: close\r\n\r\n"
        var out = Data(head.utf8)
        out.append(data)
        conn.send(content: out, completion: .contentProcessed { _ in conn.cancel() })
    }

    private func serveStatic(_ conn: NWConnection, path rawPath: String) {
        var path = rawPath
        if path == "/" { path = "/index.html" }
        path = path.removingPercentEncoding ?? path
        path = path.replacingOccurrences(of: "..", with: "")  // no escaping the web root

        let fileURL = root.appendingPathComponent(String(path.dropFirst()))
        let mimes = ["html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8",
                     "css": "text/css; charset=utf-8", "png": "image/png", "svg": "image/svg+xml",
                     "json": "application/json"]
        if let data = try? Data(contentsOf: fileURL) {
            let mime = mimes[fileURL.pathExtension.lowercased()] ?? "application/octet-stream"
            let head = "HTTP/1.1 200 OK\r\nContent-Type: \(mime)\r\nContent-Length: \(data.count)\r\n"
                     + "Cache-Control: no-store\r\nConnection: close\r\n\r\n"
            var out = Data(head.utf8)
            out.append(data)
            conn.send(content: out, completion: .contentProcessed { _ in conn.cancel() })
        } else {
            let head = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            conn.send(content: Data(head.utf8), completion: .contentProcessed { _ in conn.cancel() })
        }
    }
}

// Persisted save-folder choice; defaults to ~/Music/Muse Machine.
enum SaveDir {
    static func current() -> URL {
        if let p = UserDefaults.standard.string(forKey: "saveDir") { return URL(fileURLWithPath: p) }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Music/Muse Machine")
    }
    static func set(_ url: URL) {
        UserDefaults.standard.set(url.path, forKey: "saveDir")
    }
}

// ---------- app ----------

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var server: WebServer!

    func applicationDidFinishLaunching(_ note: Notification) {
        let webRoot = Bundle.main.resourceURL!.appendingPathComponent("web")
        server = WebServer(root: webRoot)
        try? server.start()

        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []  // songs may autoplay after SING IT

        webView = WKWebView(frame: .zero, configuration: config)
        webView.autoresizingMask = [.width, .height]

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1240, height: 880),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "Muse Machine"
        window.minSize = NSSize(width: 760, height: 560)
        window.center()
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)

        buildMenu()

        // give the listener a moment to bind, then load
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            self.webView.load(URLRequest(url: URL(string: "http://127.0.0.1:\(WebServer.port)/")!))
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    // Minimal menu so Cmd+Q / Cmd+C / Cmd+V (API key paste!) work.
    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: "About Muse Machine", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""))
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "Quit Muse Machine", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"))
        edit.addItem(NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "Z"))
        edit.addItem(.separator())
        edit.addItem(NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        edit.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        edit.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        edit.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editItem.submenu = edit

        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
