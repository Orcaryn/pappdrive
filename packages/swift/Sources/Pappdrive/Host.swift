import Foundation
import UIKit
import WebKit

/// Runs the pappdrive engine in an invisible web view and carries the RPC envelope across the WebKit bridge.
@MainActor
final class Host {
  static let scheme = "pappdrive"
  static let origin = "\(scheme)://app"

  let channel = Channel()
  private let bridge = Bridge()
  private let webView: WKWebView
  private var ready = false
  private var queued: [String] = []
  var reopens: [String: () -> Void] = [:]
  private var observers: [NSObjectProtocol] = []

  init(server: String?, app: String, read: [String], keyStore: KeyStore, syncOnBackground: Bool) {
    let start = """
      try {
        pappdrive.start(\(json(StartOptions(server: server, app: app, read: read, syncOnBackground: syncOnBackground))), text => webkit.messageHandlers.pappdrive.postMessage(text));
        webkit.messageHandlers.pappdrive.postMessage('{"method":"host.ready","params":{}}');
      } catch (e) {
        webkit.messageHandlers.pappdrive.postMessage(JSON.stringify({ method: 'host.failed', params: { message: String(e) } }));
      }
      """
    // WKWebView copies its configuration at init; everything must be on it before the view exists.
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    config.setURLSchemeHandler(bridge, forURLScheme: Host.scheme)
    config.userContentController.add(bridge, name: "pappdrive")
    config.userContentController.addUserScript(WKUserScript(source: start, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = bridge
    webView.isHidden = true

    bridge.onMessage = { [weak self] text in self?.channel.receive(text) }
    bridge.onTerminate = { [weak self] in self?.restart() }
    channel.send = { [weak self] text in self?.deliver(text) }
    channel.on("host.ready") { [weak self] (_: Empty) in self?.becameReady() }
    channel.on("host.failed") { (p: Failure) in fatalError("pappdrive: the engine did not start: \(p.message)") }
    channel.on("host.keystore.get") { (p: KeyName) in try await keyStore.get(p.name) }
    channel.on("host.keystore.set") { (p: KeyValue) in try await keyStore.set(p.name, p.value) }
    channel.on("host.keystore.delete") { (p: KeyName) in try await keyStore.delete(p.name) }

    observers = [
      NotificationCenter.default.addObserver(forName: UIWindow.didBecomeKeyNotification, object: nil, queue: .main) { [weak self] note in
        MainActor.assumeIsolated { self?.attach(to: note.object as? UIWindow) }
      }
    ]

    if syncOnBackground {
      observers.append(
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
          MainActor.assumeIsolated { self?.flushInBackground() }
        }
      )
    }

    attach(to: UIApplication.shared.connectedScenes.lazy.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first(where: \.isKeyWindow))
    webView.load(URLRequest(url: URL(string: "\(Host.origin)/index.html")!))
  }

  deinit {
    for observer in observers {
      NotificationCenter.default.removeObserver(observer)
    }

    MainActor.assumeIsolated {
      webView.configuration.userContentController.removeAllScriptMessageHandlers()
      webView.removeFromSuperview()
    }
  }

  // WebKit only runs a web view's page at full speed while the view is in a window.
  private func attach(to window: UIWindow?) {
    guard let window, webView.window !== window else {
      return
    }

    window.addSubview(webView)
  }

  private func deliver(_ text: String) {
    guard ready else {
      queued.append(text)

      return
    }

    webView.evaluateJavaScript("pappdrive.receive(\(json(text)))")
  }

  private func becameReady() {
    ready = true
    let texts = queued
    queued = []

    for text in texts {
      deliver(text)
    }
  }

  private func restart() {
    ready = false
    queued = []
    channel.failAll(PappError(code: "restarted", message: "restarted: iOS stopped the sync engine. It is starting again and reopens the folders; try again."))

    for reopen in reopens.values {
      reopen()
    }

    webView.reload()
  }

  private func flushInBackground() {
    var task = UIBackgroundTaskIdentifier.invalid
    task = UIApplication.shared.beginBackgroundTask { UIApplication.shared.endBackgroundTask(task) }

    Task { @MainActor in
      try? await channel.request("host.background", Empty())
      UIApplication.shared.endBackgroundTask(task)
    }
  }

  func evaluate(_ script: String) async throws -> Any? {
    try await webView.callAsyncJavaScript(script, contentWorld: .page)
  }
}

/// The WebKit-facing half: serves the bundle on the custom scheme, receives posted messages, notices a dead web process.
private final class Bridge: NSObject, WKScriptMessageHandler, WKURLSchemeHandler, WKNavigationDelegate {
  var onMessage: (String) -> Void = { _ in }
  var onTerminate: () -> Void = {}

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let text = message.body as? String else {
      return
    }

    onMessage(text)
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    onTerminate()
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    fatalError("pappdrive: the engine page did not load: \(error)")
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    fatalError("pappdrive: the engine page did not load: \(error)")
  }

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    let url = task.request.url!
    let file = url.lastPathComponent
    let types = ["index.html": "text/html", "pappdrive.js": "text/javascript"]

    guard let type = types[file] else {
      task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!)
      task.didFinish()

      return
    }

    let data = try! Data(contentsOf: Bundle.module.url(forResource: file, withExtension: nil)!)
    task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "\(type); charset=utf-8", "Content-Length": "\(data.count)"])!)
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

private struct StartOptions: Encodable {
  let server: String?
  let app: String
  let read: [String]
  let syncOnBackground: Bool
}

private struct Failure: Decodable {
  let message: String
}

private struct KeyName: Decodable {
  let name: String
}

private struct KeyValue: Decodable {
  let name: String
  let value: String
}
