import Foundation
import Pappdrive

@MainActor
final class JournalModel: ObservableObject {
  enum Screen: Equatable {
    case loading, signIn, recoveryCode(String), verifyEmail, journal
  }

  @Published var screen = Screen.loading
  @Published var entries: [String] = []
  @Published var current = ""
  @Published var text = ""
  @Published var status: Status?
  @Published var notice: String?

  private let papp: Pappdrive
  private var files: Files?
  private var lastSaved = ""
  private var saveTask: Task<Void, Never>?

  init(papp: Pappdrive) {
    self.papp = papp
  }

  func start() async {
    await report {
      if try await papp.signedIn() {
        try await openJournal()
      } else if let pending = try await papp.pendingSignUp() {
        screen = .recoveryCode(pending.recoveryCode)
      } else {
        screen = .signIn
      }
    }
  }

  func signIn(email: String, password: String, recoveryCode: String) async {
    await report {
      if recoveryCode.isEmpty {
        try await papp.signIn(email: email, password: password)
      } else {
        try await papp.recover(email: email, recoveryCode: recoveryCode, newPassword: password)
      }

      try await openJournal()
    }
  }

  func signUp(email: String, password: String) async {
    await report { screen = .recoveryCode(try await papp.signUp(email: email, password: password)) }
  }

  func recoveryCodeSaved() async {
    await report {
      try await papp.confirmRecoveryCode()
      screen = .verifyEmail
    }
  }

  func verifyEmail(code: String) async {
    await report {
      try await papp.verifyEmail(code)
      try await openJournal()
    }
  }

  func openUnverified() async {
    await report { try await openJournal() }
  }

  func resendVerification() async {
    await report { try await papp.sendVerificationEmail() }
  }

  func signOut() async {
    await report {
      await saveNow()
      try await papp.signOut()
      files = nil
      screen = .signIn
    }
  }

  func select(_ name: String) async {
    await report {
      await saveNow()
      current = name
      text = try await readEntry(name)
      lastSaved = text
      try await refreshList()
    }
  }

  func textChanged() {
    saveTask?.cancel()
    saveTask = Task {
      try? await Task.sleep(for: .milliseconds(800))

      if !Task.isCancelled {
        await saveNow()
      }
    }
  }

  func sync() async {
    await report { try await files?.sync() }
  }

  func deleteEntry() async {
    await report {
      saveTask?.cancel()
      lastSaved = ""
      try await remove(current)
      await select(Self.today())
    }
  }

  static func today() -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"

    return formatter.string(from: Date()) + ".md"
  }

  private func openJournal() async throws {
    let files = try await papp.open()
    self.files = files
    _ = files.watch { [weak self] change in Task { await self?.changed(change) } }
    _ = files.onStatus { [weak self] status in self?.status = status }
    status = try await files.status()
    screen = .journal
    await select(Self.today())
  }

  private func changed(_ change: Change) async {
    await report {
      try await refreshList()

      if change.origin == .conflict {
        notice = "\"\(change.path)\" was edited on two devices. The other device's version kept the name. Yours is now \"\(change.copy ?? "")\"."
      }

      guard change.path == current else {
        return
      }

      let remote = try await readEntry(current)

      if remote != lastSaved && remote != text {
        lastSaved = remote
        text = remote
      }
    }
  }

  private func saveNow() async {
    guard let files, !current.isEmpty, text != lastSaved else {
      return
    }

    let saved = text
    lastSaved = saved

    await report {
      if saved.isEmpty {
        try await remove(current)
      } else {
        try await files.write(current, text: saved)
      }
    }
  }

  private func refreshList() async throws {
    guard let files else {
      return
    }

    var names = try await files.list().filter { !$0.dir && $0.path.hasSuffix(".md") }.map(\.path).sorted(by: >)

    if !current.isEmpty && !names.contains(current) {
      names.insert(current, at: 0)
    }

    entries = names
  }

  private func readEntry(_ name: String) async throws -> String {
    do {
      return try await files!.readText(name)
    } catch let error as PappError where error.code == "not-found" {
      return ""
    }
  }

  private func remove(_ name: String) async throws {
    do {
      try await files!.remove(name)
    } catch let error as PappError where error.code == "not-found" {}
  }

  private func report(_ work: () async throws -> Void) async {
    do {
      try await work()
    } catch {
      notice = (error as? PappError)?.message ?? String(describing: error)
    }
  }
}
