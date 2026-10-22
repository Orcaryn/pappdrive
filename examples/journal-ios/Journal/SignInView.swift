import SwiftUI

struct SignInView: View {
  @ObservedObject var model: JournalModel
  @State private var email = ""
  @State private var password = ""
  @State private var recoveryCode = ""

  var body: some View {
    Form {
      Section("Sign in to sync your journal between your devices") {
        TextField("Email", text: $email).textContentType(.username).keyboardType(.emailAddress).textInputAutocapitalization(.never).accessibilityIdentifier("email")
        SecureField("Password, 12 characters or more", text: $password).textContentType(.password).accessibilityIdentifier("password")
        TextField("Recovery code, only if you forgot the password", text: $recoveryCode).textInputAutocapitalization(.characters)
      }
      Section {
        Button("Sign in") { Task { await model.signIn(email: email, password: password, recoveryCode: recoveryCode) } }
        Button("Create account") { Task { await model.signUp(email: email, password: password) } }
      }
      if let notice = model.notice {
        Section { Text(notice).foregroundStyle(.red) }
      }
    }
  }
}

struct RecoveryCodeView: View {
  @ObservedObject var model: JournalModel
  let code: String
  @State private var check = ""
  @FocusState private var typing: Bool

  var body: some View {
    Form {
      Section("Save this recovery code. It is the only way back in if you forget your password.") {
        Text(code).font(.system(.title3, design: .monospaced)).textSelection(.enabled).accessibilityIdentifier("recovery-code")
      }
      Section("Type the last group of the code to continue") {
        TextField("Last group", text: $check).textInputAutocapitalization(.characters).accessibilityIdentifier("recovery-check").focused($typing)
        Button("I saved it") { Task { await model.recoveryCodeSaved() } }
          .disabled(check.trimmingCharacters(in: .whitespaces).uppercased() != code.split(separator: "-").last.map(String.init))
      }
    }
    .onAppear { typing = true }
  }
}

struct VerifyEmailView: View {
  @ObservedObject var model: JournalModel
  @State private var code = ""

  var body: some View {
    Form {
      Section("Enter the code from the email we sent") {
        TextField("Code", text: $code).keyboardType(.numberPad)
        Button("Verify") { Task { await model.verifyEmail(code: code) } }
        Button("Send the email again") { Task { await model.resendVerification() } }
      }
      Section("Or write now; the journal syncs once the email is confirmed") {
        Button("Later") { Task { await model.openUnverified() } }
      }
      if let notice = model.notice {
        Section { Text(notice).foregroundStyle(.red) }
      }
    }
  }
}
