# Journal for iOS

A native SwiftUI journal that syncs between the user's devices. One Markdown file per day, stored and synced by the pappdrive engine running inside the app (`packages/swift`).

```sh
cd packages/pappdrive && pnpm build       # builds the engine and copies it into the Swift package
cd ../../examples/journal-ios
xcodegen generate                          # brew install xcodegen
open Journal.xcodeproj
```

Create the `journal` app once with `npx pappdrive apps create journal`, or create the account from the app's own sign-up form, which also creates the app.

`JournalUITests` drives the whole flow on the simulator against the real server: sign up, confirm the recovery code after a relaunch, open the journal unverified, relaunch, write, relaunch, read back. It creates an account and prints its email; delete it afterwards with `npx pappdrive delete-account` (password: `twelve characters at least`). Before a run: `xcrun simctl uninstall booted com.pappdrive.example.Journal && xcrun simctl keychain booted reset`.

```sh
xcodebuild -project Journal.xcodeproj -scheme Journal -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```
