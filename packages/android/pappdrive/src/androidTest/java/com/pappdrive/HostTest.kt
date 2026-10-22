package com.pappdrive

import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.json.JSONObject
import java.util.UUID

/** Runs the real bundle in a WebView on the emulator. */
@RunWith(AndroidJUnit4::class)
class HostTest {
  private class MemoryKeyStore : KeyStore {
    val values = HashMap<String, String>()
    override suspend fun get(name: String) = values[name]
    override suspend fun set(name: String, value: String) { values[name] = value }
    override suspend fun delete(name: String) { values.remove(name) }
  }

  private fun papp(server: String, keyStore: KeyStore = MemoryKeyStore()): Pappdrive {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    lateinit var papp: Pappdrive
    InstrumentationRegistry.getInstrumentation().runOnMainSync { papp = Pappdrive(context, server, "journal", keyStore = keyStore) }

    return papp
  }

  @Test
  fun keystoreKeyStoreKeepsValuesOutsideBackup() = runBlocking {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val store = KeystoreKeyStore(context, alias = "pappdrive-test")
    val name = "pappdrive:https://sync.test:journal"
    assertEquals(null, store.get(name))
    store.set(name, "session")
    assertEquals("session", store.get(name))
    assertTrue(context.noBackupFilesDir.resolve("pappdrive-keys").list()!!.isNotEmpty())
    store.delete(name)
    assertEquals(null, store.get(name))
  }

  @Test
  fun signedInReadsTheHostKeyStore() = runBlocking {
    assertFalse(papp("https://127.0.0.1:9").signedIn())
  }

  @Test
  fun bytesCrossTheBridgeInSlices() = runBlocking {
    val server = "https://127.0.0.1:9"
    val keyStore = MemoryKeyStore()
    keyStore.values["pappdrive:$server:journal"] = JSONObject()
      .put("email", "a@b.c")
      .put("userId", "slices-test")
      .put("refreshToken", "r")
      .put("dataKey", Base64.encodeToString(ByteArray(32), Base64.NO_WRAP))
      .put("recoveryCode", JSONObject.NULL)
      .toString()
    val files = papp(server, keyStore).open()
    val big = ByteArray(5 * 1024 * 1024 / 2) { (it % 251).toByte() }
    files.write("big.bin", big)
    assertArrayEquals(big, files.read("big.bin"))
  }

  @Test
  fun openWithoutSessionIsSignedOut() = runBlocking {
    try {
      papp("https://127.0.0.1:9").open()
      fail("expected a throw")
    } catch (e: PappException) {
      assertEquals("signed-out", e.code)
    }
  }

  @Test
  fun signInWithoutServerIsANetworkError() = runBlocking {
    try {
      papp("https://127.0.0.1:9").signIn("a@b.c", "twelve characters")
      fail("expected a throw")
    } catch (e: PappException) {
      assertEquals(e.message, "network", e.code)
    }
  }

  /** Signs up on the real server, writes and reads in OPFS, then deletes the account. Needs the network. */
  @Test
  fun signUpOpenWriteReadDelete() = runBlocking {
    val papp = papp("https://sync.pappdrive.com")
    val email = "e2e-${UUID.randomUUID().toString().take(8)}@example.com"
    val password = "twelve characters at least"
    val code = papp.signUp(email, password)
    assertEquals(code, 5, code.split("-").size)
    assertEquals(email, papp.pendingSignUp()?.email)
    papp.confirmRecoveryCode()
    assertTrue(papp.signedIn())
    val files = papp.open()
    files.write("hello.md", "Hello from the emulator")
    assertEquals("Hello from the emulator", files.readText("hello.md"))
    assertEquals(listOf("hello.md"), files.list().map { it.path })
    papp.deleteAccount(password)
    assertFalse(papp.signedIn())
  }
}
