# Pappdrive for iOS

The pappdrive engine (`packages/pappdrive`, built as `dist/embedded.js`) running in a `WKWebView` the app never shows, behind a Swift API that mirrors the JavaScript one. How it works and what to expect: [docs/hosts.md](../../docs/hosts.md).

```swift
let papp = Pappdrive(server: "https://sync.pappdrive.com", app: "journal")
if try await !papp.signedIn() { try await papp.signIn(email: email, password: password) }
let files = try await papp.open()
try await files.write("2026-10-21.md", text: "Hello")
```

The manifest is `Package.swift` at the repository root, so the package can be added by URL. Tests run the real bundle on the simulator, from the root:

```sh
xcodebuild -scheme Pappdrive -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

`Sources/Pappdrive/Resources/pappdrive.js` is a build product; `pnpm build` in `packages/pappdrive` refreshes it.
