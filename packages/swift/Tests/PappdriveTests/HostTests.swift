import UIKit
import XCTest
@testable import Pappdrive

/// Runs the real bundle in a WKWebView on the simulator. No server: these calls stop at the key store or the network.
@MainActor
final class HostTests: XCTestCase {
  // The test runner has no window of its own; the engine's web view needs one to run at full speed.
  private var window: UIWindow!

  override func setUp() {
    window = UIWindow(frame: UIScreen.main.bounds)
    window.rootViewController = UIViewController()
    window.makeKeyAndVisible()
  }

  final class MemoryKeyStore: KeyStore, @unchecked Sendable {
    var values: [String: String] = [:]
    func get(_ name: String) async throws -> String? { values[name] }
    func set(_ name: String, _ value: String) async throws { values[name] = value }
    func delete(_ name: String) async throws { values[name] = nil }
  }

  func testPageIsASecureContextWithStorageAndCrypto() async throws {
    let papp = Pappdrive(server: "https://127.0.0.1:9", app: "journal", keyStore: MemoryKeyStore())
    _ = try await papp.signedIn()
    let probe = try await papp.evaluate("return [isSecureContext, !!crypto.subtle, !!navigator.storage.getDirectory, !!WebAssembly, location.origin]") as? [Any]
    XCTAssertEqual(probe?[0] as? Bool, true)
    XCTAssertEqual(probe?[1] as? Bool, true)
    XCTAssertEqual(probe?[2] as? Bool, true)
    XCTAssertEqual(probe?[3] as? Bool, true)
    XCTAssertEqual(probe?[4] as? String, Host.origin)
  }

  func testOpfsWritesAndMovesFiles() async throws {
    let papp = Pappdrive(server: "https://127.0.0.1:9", app: "journal", keyStore: MemoryKeyStore())
    _ = try await papp.signedIn()
    let result = try await papp.evaluate("""
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("probe", { create: true });
      const file = await dir.getFileHandle("a.txt", { create: true });
      const writable = await file.createWritable();
      await writable.write("hello");
      await writable.close();
      const text = await (await file.getFile()).text();
      await file.move(dir, "b.txt");
      const names = [];
      for await (const name of dir.keys()) names.push(name);
      await root.removeEntry("probe", { recursive: true });
      return [text, names];
      """) as? [Any]
    XCTAssertEqual(result?[0] as? String, "hello")
    XCTAssertEqual(result?[1] as? [String], ["b.txt"])
  }

  // The engine writes a temp chunk under .pappdrive/tmp/<id>/ and moves it into place across directories.
  func testOpfsMovesAcrossDirectories() async throws {
    let papp = Pappdrive(server: "https://127.0.0.1:9", app: "journal", keyStore: MemoryKeyStore())
    _ = try await papp.signedIn()
    let result = try await papp.evaluate("""
      const root = await navigator.storage.getDirectory();
      const app = await root.getDirectoryHandle("probe2", { create: true });
      const hidden = await app.getDirectoryHandle(".pappdrive", { create: true });
      const tmp = await hidden.getDirectoryHandle("tmp", { create: true });
      const tdir = await tmp.getDirectoryHandle("t1", { create: true });
      const chunk = await tdir.getFileHandle("00000000", { create: true });
      const writable = await chunk.createWritable();
      await writable.write(new Uint8Array([104, 105]));
      await writable.close();
      const sub = await app.getDirectoryHandle("notes", { create: true });
      await chunk.move(sub, "hello.md");
      await tmp.removeEntry("t1", { recursive: true });
      const moved = await chunk.getFile();
      const again = await (await (await sub.getFileHandle("hello.md")).getFile()).text();
      await root.removeEntry("probe2", { recursive: true });
      return [moved.size, moved.lastModified > 0, again];
      """) as? [Any]
    XCTAssertEqual(result?[0] as? Int, 2)
    XCTAssertEqual(result?[1] as? Bool, true)
    XCTAssertEqual(result?[2] as? String, "hi")
  }

  // Safari before 26 has no createWritable; the engine then writes in a worker with a sync access handle and moves the file over the old one.
  func testOpfsWorkerWriteReplacesAFile() async throws {
    let papp = Pappdrive(server: "https://127.0.0.1:9", app: "journal", keyStore: MemoryKeyStore())
    _ = try await papp.signedIn()
    let result = try await papp.evaluate("""
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("probe3", { create: true });
      const old = await dir.getFileHandle("b.txt", { create: true });
      const worker = new Worker(URL.createObjectURL(new Blob([`onmessage = async () => {
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("probe3");
        const handle = await (await dir.getFileHandle("b.txt.saving", { create: true })).createSyncAccessHandle();
        handle.write(new TextEncoder().encode("new"), { at: 0 });
        handle.flush();
        handle.close();
        postMessage("done");
      }`], { type: "text/javascript" })));
      await new Promise((resolve, reject) => { worker.onmessage = resolve; worker.onerror = e => reject(new Error(e.message)); worker.postMessage(null); });
      worker.terminate();
      const saved = await dir.getFileHandle("b.txt.saving");
      await saved.move(dir, "b.txt");
      const text = await (await (await dir.getFileHandle("b.txt")).getFile()).text();
      const names = [];
      for await (const name of dir.keys()) names.push(name);
      await root.removeEntry("probe3", { recursive: true });
      return [text, names];
      """) as? [Any]
    XCTAssertEqual(result?[0] as? String, "new")
    XCTAssertEqual(result?[1] as? [String], ["b.txt"])
  }

  func testSignedInReadsTheHostKeyStore() async throws {
    let keyStore = MemoryKeyStore()
    let papp = Pappdrive(server: "https://127.0.0.1:9", app: "journal", keyStore: keyStore)
    let before = try await papp.signedIn()
    XCTAssertFalse(before)
  }

  func testBytesCrossTheBridgeInSlices() async throws {
    let server = "https://127.0.0.1:9"
    let keyStore = MemoryKeyStore()
    keyStore.values["pappdrive:\(server):journal"] =
      #"{"email":"a@b.c","userId":"\#(UUID().uuidString)","refreshToken":"r","dataKey":"\#(Data(count: 32).base64EncodedString())","recoveryCode":null}"#
    let papp = Pappdrive(server: server, app: "journal", keyStore: keyStore)
    // The test process has no UIApplication scenes, so the engine finds no key window until one becomes key again.
    window.resignKey()
    window.makeKey()
    let files = try await papp.open()
    let big = Data((0..<(5 * 1024 * 1024 / 2)).map { UInt8($0 % 251) })
    try await files.write("big.bin", data: big)
    let read = try await files.read("big.bin")
    XCTAssertEqual(read, big)

    let source = FileManager.default.temporaryDirectory.appendingPathComponent("pappdrive-in.bin")
    let target = FileManager.default.temporaryDirectory.appendingPathComponent("pappdrive-out.bin")
    try big.write(to: source)
    try await files.write("copy.bin", contentsOf: source)
    try await files.read("copy.bin", to: target)
    XCTAssertEqual(try Data(contentsOf: target), big)
  }

  func testOpenWithoutSessionIsSignedOut() async throws {
    let papp = Pappdrive(server: "https://127.0.0.1:9", app: "journal", keyStore: MemoryKeyStore())

    do {
      _ = try await papp.open()
      XCTFail("expected a throw")
    } catch let error as PappError {
      XCTAssertEqual(error.code, "signed-out")
    }
  }

  func testSignInWithoutServerIsANetworkError() async throws {
    let papp = Pappdrive(server: "https://127.0.0.1:9", app: "journal", keyStore: MemoryKeyStore())

    do {
      try await papp.signIn(email: "a@b.c", password: "twelve characters")
      XCTFail("expected a throw")
    } catch let error as PappError {
      XCTAssertEqual(error.code, "network", error.message)
    }
  }
}
