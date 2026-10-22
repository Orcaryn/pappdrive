import XCTest
@testable import Pappdrive

@MainActor
final class ChannelTests: XCTestCase {
  func testRequestGetsItsReply() async throws {
    let channel = Channel()
    channel.send = { text in
      XCTAssertEqual(text, #"{"id":1,"method":"signedIn","params":{}}"#)
      channel.receive(#"{"id":1,"ok":true,"value":true}"#)
    }
    let signedIn: Bool = try await channel.request("signedIn", Empty())
    XCTAssertTrue(signedIn)
  }

  func testErrorReplyThrowsPappError() async {
    let channel = Channel()
    channel.send = { _ in channel.receive(#"{"id":1,"ok":false,"error":{"code":"not-found","message":"not-found: gone","retryAfter":7}}"#) }

    do {
      let _: String = try await channel.request("files.readText", ["files": "own", "path": "x"])
      XCTFail("expected a throw")
    } catch let error as PappError {
      XCTAssertEqual(error.code, "not-found")
      XCTAssertEqual(error.message, "not-found: gone")
      XCTAssertEqual(error.retryAfter, 7)
    } catch {
      XCTFail("wrong error \(error)")
    }
  }

  func testIncomingRequestIsAnsweredWithValue() async throws {
    let channel = Channel()
    let replied = expectation(description: "reply")
    channel.on("host.keystore.get") { (p: [String: String]) in "secret-\(p["name"]!)" }
    channel.send = { text in
      XCTAssertEqual(text, #"{"id":9,"ok":true,"value":"secret-k"}"#)
      replied.fulfill()
    }
    channel.receive(#"{"id":9,"method":"host.keystore.get","params":{"name":"k"}}"#)
    await fulfillment(of: [replied], timeout: 1)
  }

  func testUnknownMethodIsBadRequest() {
    let channel = Channel()
    var sent = ""
    channel.send = { sent = $0 }
    channel.receive(#"{"id":2,"method":"nope","params":{}}"#)
    XCTAssertTrue(sent.contains(#""code":"bad-request""#), sent)
  }

  func testFailAllRejectsPending() async {
    let channel = Channel()
    channel.send = { _ in }
    async let waiting: Bool = channel.request("signedIn", Empty())
    await Task.yield()
    channel.failAll(PappError(code: "restarted", message: "restarted"))

    do {
      _ = try await waiting
      XCTFail("expected a throw")
    } catch let error as PappError {
      XCTAssertEqual(error.code, "restarted")
    } catch {
      XCTFail("wrong error \(error)")
    }
  }
}
