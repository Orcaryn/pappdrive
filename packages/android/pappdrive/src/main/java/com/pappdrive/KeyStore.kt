package com.pappdrive

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.net.URLEncoder
import java.security.KeyStore as AndroidKeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface KeyStore {
  suspend fun get(name: String): String?
  suspend fun set(name: String, value: String)
  suspend fun delete(name: String)
}

/** Keeps each value in a file under noBackupFilesDir, sealed with an AES key that lives in the Android Keystore and never leaves the device. */
class KeystoreKeyStore(context: Context, private val alias: String = "pappdrive") : KeyStore {
  private val dir = File(context.applicationContext.noBackupFilesDir, "pappdrive-keys")

  private fun key(): SecretKey {
    val store = AndroidKeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(alias, null) as SecretKey?)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .build(),
    )

    return generator.generateKey()
  }

  override suspend fun get(name: String): String? = withContext(Dispatchers.IO) {
    val bytes = try {
      AtomicFile(File(dir, URLEncoder.encode(name, "UTF-8"))).readFully()
    } catch (e: FileNotFoundException) {
      return@withContext null
    }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, 12))

    String(cipher.doFinal(bytes, 12, bytes.size - 12), Charsets.UTF_8)
  }

  override suspend fun set(name: String, value: String) = withContext(Dispatchers.IO) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val sealed = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    dir.mkdirs()
    val file = AtomicFile(File(dir, URLEncoder.encode(name, "UTF-8")))
    val out = file.startWrite()

    try {
      out.write(sealed)
      file.finishWrite(out)
    } catch (e: IOException) {
      file.failWrite(out)

      throw e
    }
  }

  override suspend fun delete(name: String) = withContext(Dispatchers.IO) {
    AtomicFile(File(dir, URLEncoder.encode(name, "UTF-8"))).delete()
  }
}
