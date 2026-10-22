# pappdrive for Android

The pappdrive engine (`packages/pappdrive`, built as `dist/embedded.js`) running in a WebView the app never shows, behind a Kotlin API that mirrors the JavaScript one.

```kotlin
val papp = Pappdrive(context, server = "https://sync.pappdrive.com", app = "journal")
if (!papp.signedIn()) papp.signIn(email, password)
val files = papp.open()
files.write("2026-10-21.md", "Hello")
files.watch { change -> ... }
```

Build: `./gradlew :pappdrive:assembleRelease` after `pnpm build` in `packages/pappdrive` (which copies `embedded.js` into `src/main/assets`). Needs JDK 17 and the Android SDK with platform 36 and build-tools 36; point `local.properties` (`sdk.dir=...`) or `ANDROID_HOME` at it. The wrapper pins Gradle 8.14, the newest that AGP 8.13 supports.

The Kotlin is a straight port of the Swift package in `packages/swift`. Its instrumented tests run the real bundle in a WebView on an emulator, including a sign-up, write, read and account deletion against `https://sync.pappdrive.com`:

```sh
./gradlew :pappdrive:connectedDebugAndroidTest   # with an emulator or device attached
```
