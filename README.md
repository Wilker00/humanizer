# Humanizer

Humanizer is a browser-based songwriting workspace that turns a hummed or sung idea into editable notes and a beat. Users can arrange sections, shape the sound, mix tracks, and export WAV, MIDI, stems, or a portable share pack.

The application is local-first: projects and captured audio stay in the browser. Tone.js 14.8.49 and the UI fonts are checked into the repository, so the core demo has no third-party runtime dependency.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in Chrome or Edge. For the fastest demo path, choose **Start a song**, then **Use demo idea**.

## Verify

```bash
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm test` runs the music-engine suite. The Playwright smoke test clicks through the landing page, demo analysis, workspace, producer tools, save/reopen flow, and a mobile layout check. GitHub Actions runs both suites on every push and pull request.

## Product notes

- Live microphone capture requires browser permission and a secure context outside localhost.
- Live lyric capture uses the browser Speech Recognition API when available. Uploaded audio does not currently receive automatic transcription; users can type and align lyrics in the workspace.
- The checked-in `vendor/` and `assets/fonts/` files include their respective open-source licenses.
