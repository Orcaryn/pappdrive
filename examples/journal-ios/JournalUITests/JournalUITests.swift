import XCTest

/// Creates an account on the real server, writes an entry, relaunches, reads it back. Needs the network.
/// Prints the account's email; delete it afterwards with `pappdrive delete-account`.
final class JournalUITests: XCTestCase {
  func testSignUpWriteRelaunchRead() throws {
    let app = XCUIApplication()
    app.launch()
    let email = "e2e-\(UUID().uuidString.lowercased().prefix(8))@example.com"
    let password = "twelve characters at least"
    print("e2e account: \(email)")

    let emailField = app.textFields["email"]
    XCTAssertTrue(emailField.waitForExistence(timeout: 60))
    emailField.tap()
    emailField.typeText(email)
    app.secureTextFields["password"].tap()
    app.secureTextFields["password"].typeText(password)
    app.buttons["Create account"].tap()

    var code = app.staticTexts["recovery-code"]
    XCTAssertTrue(code.waitForExistence(timeout: 120), "sign-up did not finish")

    // A relaunch lands on the same screen through pendingSignUp, with a fresh keyboard for the form.
    app.terminate()
    app.launch()
    code = app.staticTexts["recovery-code"]
    XCTAssertTrue(code.waitForExistence(timeout: 60), "pendingSignUp did not bring the code back")
    let last = code.label.split(separator: "-").last.map(String.init)!
    let check = app.textFields["recovery-check"]
    XCTAssertTrue(check.waitForExistence(timeout: 10))
    check.tap()
    check.typeText(last)
    print("e2e code: \(code.label) typed: \(last) field: \(String(describing: check.value))")
    let saved = app.buttons["I saved it"]
    XCTAssertTrue(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == true"), object: saved)], timeout: 10) == .completed, "the last group did not match")
    saved.tap()

    let later = app.buttons["Later"]
    XCTAssertTrue(later.waitForExistence(timeout: 30))
    later.tap()

    var editor = app.textViews["editor"]
    XCTAssertTrue(editor.waitForExistence(timeout: 60), "the journal did not open")

    // Relaunch: the session comes back from the Keychain and the journal opens straight away.
    app.terminate()
    app.launch()
    editor = app.textViews["editor"]
    if !editor.waitForExistence(timeout: 60) {
      print("e2e screen: \(app.staticTexts.allElementsBoundByIndex.map(\.label))")
      XCTFail("the journal did not reopen from the saved session")
    }
    editor.tap()
    editor.typeText("Hello from the simulator")
    let status = app.staticTexts["status"]
    XCTAssertTrue(status.waitForExistence(timeout: 30))
    sleep(3)

    app.terminate()
    app.launch()
    XCTAssertTrue(editor.waitForExistence(timeout: 60), "the journal did not reopen after relaunch")
    let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Hello from the simulator"), object: editor)
    XCTWaiter().wait(for: [expectation], timeout: 30)
    XCTAssertEqual(editor.value as? String, "Hello from the simulator")
    print("e2e status: \(status.label)")
  }
}
