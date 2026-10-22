import Foundation

/// One synced, end-to-end encrypted folder for this app. Mirrors the JavaScript `Papp` API; see docs/api.md.
@MainActor
public final class Pappdrive {
  private let host: Host
  private let listeners = Listeners()

  public init(server: String, app: String, read: [String] = [], keyStore: KeyStore = KeychainKeyStore(), syncOnBackground: Bool = false) {
    host = Host(server: server, app: app, read: read, keyStore: keyStore, syncOnBackground: syncOnBackground)
    host.channel.on("change") { [listeners] (event: ChangeEvent) in listeners.deliver(event.files, event.change) }
    host.channel.on("status") { [listeners] (event: StatusEvent) in listeners.deliver(event.files, event.status) }
  }

  public func signedIn() async throws -> Bool {
    try await host.channel.request("signedIn", Empty())
  }

  public func open() async throws -> Files {
    try await open("open", ["where": ["mode": "private"]])
  }

  public func openReadOnly(_ app: String) async throws -> Files {
    try await open("openReadOnly", ["app": app])
  }

  private func open<P: Encodable>(_ method: String, _ params: P) async throws -> Files {
    let handle: String = try await host.channel.request(method, params)
    host.reopens[handle] = { [channel = host.channel] in channel.requestWithoutReply(method, params) }

    return Files(handle: handle, host: host, listeners: listeners)
  }

  public func signUp(email: String, password: String) async throws -> String {
    let result: RecoveryCode = try await host.channel.request("signUp", ["email": email, "password": password])

    return result.recoveryCode
  }

  public func pendingSignUp() async throws -> PendingSignUp? {
    try await host.channel.request("pendingSignUp", Empty())
  }

  public func confirmRecoveryCode() async throws {
    try await host.channel.request("confirmRecoveryCode", Empty())
  }

  public func verifyEmail(_ code: String) async throws {
    try await host.channel.request("verifyEmail", ["code": code])
  }

  public func sendVerificationEmail() async throws {
    try await host.channel.request("sendVerificationEmail", Empty())
  }

  public func signIn(email: String, password: String) async throws {
    try await host.channel.request("signIn", ["email": email, "password": password])
  }

  public func recover(email: String, recoveryCode: String, newPassword: String) async throws {
    try await host.channel.request("recover", ["email": email, "recoveryCode": recoveryCode, "newPassword": newPassword])
  }

  public func setPassword(_ newPassword: String) async throws {
    try await host.channel.request("setPassword", ["newPassword": newPassword])
  }

  public func signOut() async throws {
    defer { host.reopens = [:] }
    try await host.channel.request("signOut", Empty())
  }

  public func deleteApp(password: String) async throws {
    try await host.channel.request("deleteApp", ["password": password])
    host.reopens = [:]
  }

  public func deleteAccount(password: String) async throws {
    try await host.channel.request("deleteAccount", ["password": password])
    host.reopens = [:]
  }

  public func close() async throws {
    defer { host.reopens = [:] }
    try await host.channel.request("close", Empty())
  }

  func evaluate(_ script: String) async throws -> Any? {
    try await host.evaluate(script)
  }
}

private struct RecoveryCode: Decodable {
  let recoveryCode: String
}

private struct ChangeEvent: Decodable {
  let files: String
  let change: Change
}

private struct StatusEvent: Decodable {
  let files: String
  let status: Status
}
