import Pappdrive
import SwiftUI

let server = "https://sync.pappdrive.com"

@main
struct JournalApp: App {
  @StateObject private var model = JournalModel(papp: Pappdrive(server: server, app: "journal"))

  var body: some Scene {
    WindowGroup {
      Group {
        switch model.screen {
        case .loading:
          VStack(spacing: 16) {
            ProgressView()
            if let notice = model.notice {
              Text(notice).foregroundStyle(.red).padding()
            }
          }
        case .signIn: SignInView(model: model)
        case .recoveryCode(let code): RecoveryCodeView(model: model, code: code)
        case .verifyEmail: VerifyEmailView(model: model)
        case .journal: JournalView(model: model)
        }
      }
      .task { await model.start() }
    }
  }
}
