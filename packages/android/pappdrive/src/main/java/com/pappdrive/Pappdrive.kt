package com.pappdrive

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** One synced, end-to-end encrypted folder for this app. Mirrors the JavaScript `Papp` API; see docs/api.md. */
class Pappdrive(context: Context, server: String, app: String, read: List<String> = emptyList(), keyStore: KeyStore = KeystoreKeyStore(context), syncOnBackground: Boolean = false) {
  private val host = Host(context, server, app, read, keyStore, syncOnBackground)
  private val listeners = Listeners()

  init {
    host.channel.on("change") { listeners.deliverChange(it.getString("files"), Change.from(it.getJSONObject("change"))) }
    host.channel.on("status") { listeners.deliverStatus(it.getString("files"), Status.from(it.getJSONObject("status"))) }
  }

  internal suspend fun call(method: String, params: JSONObject = JSONObject()): Any? = withContext(Dispatchers.Main.immediate) { host.channel.request(method, params) }

  suspend fun signedIn(): Boolean = call("signedIn") as Boolean

  suspend fun open(): Files = open("open", JSONObject().put("where", JSONObject().put("mode", "private")))

  suspend fun openReadOnly(app: String): Files = open("openReadOnly", JSONObject().put("app", app))

  private suspend fun open(method: String, params: JSONObject): Files = withContext(Dispatchers.Main.immediate) {
    val handle = host.channel.request(method, params) as String
    host.reopens[handle] = method to params
    Files(handle, this@Pappdrive, listeners)
  }

  /** Returns the recovery code. Show it, make the user save it, then call [confirmRecoveryCode]. */
  suspend fun signUp(email: String, password: String): String = (call("signUp", JSONObject().put("email", email).put("password", password)) as JSONObject).getString("recoveryCode")

  suspend fun pendingSignUp(): PendingSignUp? {
    val value = call("pendingSignUp") as? JSONObject ?: return null

    return PendingSignUp(value.getString("email"), value.getString("recoveryCode"))
  }

  suspend fun confirmRecoveryCode() {
    call("confirmRecoveryCode")
  }

  suspend fun verifyEmail(code: String) {
    call("verifyEmail", JSONObject().put("code", code))
  }

  suspend fun sendVerificationEmail() {
    call("sendVerificationEmail")
  }

  suspend fun signIn(email: String, password: String) {
    call("signIn", JSONObject().put("email", email).put("password", password))
  }

  suspend fun recover(email: String, recoveryCode: String, newPassword: String) {
    call("recover", JSONObject().put("email", email).put("recoveryCode", recoveryCode).put("newPassword", newPassword))
  }

  suspend fun setPassword(newPassword: String) {
    call("setPassword", JSONObject().put("newPassword", newPassword))
  }

  suspend fun signOut() {
    withContext(Dispatchers.Main.immediate) {
      try {
        host.channel.request("signOut", JSONObject())
      } finally {
        host.reopens.clear()
      }
    }
  }

  suspend fun deleteApp(password: String) {
    withContext(Dispatchers.Main.immediate) {
      host.channel.request("deleteApp", JSONObject().put("password", password))
      host.reopens.clear()
    }
  }

  suspend fun deleteAccount(password: String) {
    withContext(Dispatchers.Main.immediate) {
      host.channel.request("deleteAccount", JSONObject().put("password", password))
      host.reopens.clear()
    }
  }

  suspend fun close() {
    withContext(Dispatchers.Main.immediate) {
      try {
        host.channel.request("close", JSONObject())
      } finally {
        host.reopens.clear()
      }
    }
  }

  /** Stops the engine and its web view. Main thread only; every call after this throws `released`. */
  fun release() {
    host.release()
  }
}
