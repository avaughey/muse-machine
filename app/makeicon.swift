// Renders the app icon: a pastel dream-sky rounded square with a cloud + music note.
import AppKit

let size = NSSize(width: 1024, height: 1024)
let img = NSImage(size: size)
img.lockFocus()

let inset = NSRect(x: 92, y: 92, width: 840, height: 840)
let squircle = NSBezierPath(roundedRect: inset, xRadius: 190, yRadius: 190)
NSGradient(colors: [
    NSColor(calibratedRed: 0.55, green: 0.78, blue: 1.00, alpha: 1),
    NSColor(calibratedRed: 0.79, green: 0.76, blue: 1.00, alpha: 1),
    NSColor(calibratedRed: 1.00, green: 0.79, blue: 0.93, alpha: 1),
    NSColor(calibratedRed: 1.00, green: 0.90, blue: 0.78, alpha: 1),
])!.draw(in: squircle, angle: -70)

let text = "☁️" as NSString
var attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 560)]
var bounds = text.size(withAttributes: attrs)
text.draw(at: NSPoint(x: (1024 - bounds.width) / 2, y: (1024 - bounds.height) / 2 + 30), withAttributes: attrs)

let note = "🎶" as NSString
attrs = [.font: NSFont.systemFont(ofSize: 260)]
bounds = note.size(withAttributes: attrs)
note.draw(at: NSPoint(x: (1024 - bounds.width) / 2 + 130, y: 210), withAttributes: attrs)

img.unlockFocus()

guard let tiff = img.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
    fatalError("could not render icon")
}
try! png.write(to: URL(fileURLWithPath: "icon-1024.png"))
print("wrote icon-1024.png")
