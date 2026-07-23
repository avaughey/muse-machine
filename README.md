# Muse Machine ☁️🎛

An anti-writer's-block dream studio: roll a vibe, jam it live, write lyrics, and have them actually sung — while flying through clouds.

- **Vibe** — dice-roll genre / mood / instrument / texture / voice / era, creative dares, first-line seeds
- **Jam** — live-steered streaming music (Google Lyria RealTime, needs a [Google AI Studio key](https://aistudio.google.com/apikey))
- **DreamBox** — fully offline generative groovebox, zero keys required
- **Write** — lyric pad with AI next-lines & rhymes
- **Sing** — real sung vocals from your lyrics or a one-sentence idea (Lyria 3), with track history

No build step — static HTML/JS. Serve the folder with any web server, or open the GitHub Pages deployment on any device (on iPhone: Share → **Add to Home Screen**). Your API key is stored only in your browser's localStorage and sent only to Google's APIs.

`app/` contains a native macOS wrapper (Swift + WKWebView): `bash app/build-app.sh` builds `MuseMachine.app`.

Made for fun with Claude.
