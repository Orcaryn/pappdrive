package com.pappdrive

import android.util.Base64
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID

/** The files of one open folder. Paths are relative, `/`-separated; see docs/api.md for the path rules. */
class Files internal constructor(val handle: String, private val papp: Pappdrive, private val listeners: Listeners) {
  private fun params(): JSONObject = JSONObject().put("files", handle)

  suspend fun readOnly(): Boolean = papp.call("files.readOnly", params()) as Boolean

  suspend fun write(path: String, text: String) {
    papp.call("files.writeText", params().put("path", path).put("text", text))
  }

  suspend fun write(path: String, data: ByteArray) = write(path, data.inputStream())

  /** Streams [source] into [path], one slice at a time, so a big file never sits in memory whole. Does not close [source]. */
  suspend fun write(path: String, source: InputStream) {
    val id = papp.call("files.writeStart", params().put("path", path)) as Int

    try {
      val slice = ByteArray(SLICE)

      while (true) {
        val n = source.read(slice)

        if (n == -1) {
          break
        }

        papp.call("files.writeChunk", JSONObject().put("id", id).put("base64", Base64.encodeToString(slice, 0, n, Base64.NO_WRAP)))
      }
    } catch (e: Throwable) {
      withContext(NonCancellable) { papp.call("files.cancel", JSONObject().put("id", id)) }

      throw e
    }

    papp.call("files.writeEnd", JSONObject().put("id", id))
  }

  suspend fun read(path: String): ByteArray = ByteArrayOutputStream().also { read(path, it) }.toByteArray()

  /** Streams [path] into [target], one slice at a time. Does not close [target]; if it throws, [target] holds an incomplete file. */
  suspend fun read(path: String, target: OutputStream) {
    val id = papp.call("files.readStart", params().put("path", path)) as Int

    try {
      while (true) {
        val slice = papp.call("files.readChunk", JSONObject().put("id", id))

        if (slice == JSONObject.NULL) {
          return
        }

        target.write(Base64.decode(slice as String, Base64.NO_WRAP))
      }
    } catch (e: Throwable) {
      withContext(NonCancellable) { papp.call("files.cancel", JSONObject().put("id", id)) }

      throw e
    }
  }

  suspend fun readText(path: String): String = papp.call("files.readText", params().put("path", path)) as String

  suspend fun list(dir: String? = null): List<FileInfo> {
    val entries = papp.call("files.list", if (dir == null) params() else params().put("dir", dir)) as JSONArray

    return List(entries.length()) { FileInfo.from(entries.getJSONObject(it)) }
  }

  suspend fun remove(path: String) {
    papp.call("files.remove", params().put("path", path))
  }

  suspend fun status(): Status = Status.from(papp.call("files.status", params()) as JSONObject)

  suspend fun sync() {
    papp.call("files.sync", params())
  }

  /** Calls back on the main thread for every change to this folder until the returned function runs. */
  fun watch(callback: (Change) -> Unit): () -> Unit = listeners.addChange(handle, callback)

  fun onStatus(callback: (Status) -> Unit): () -> Unit = listeners.addStatus(handle, callback)

  private companion object {
    const val SLICE = 1 shl 20
  }
}

internal class Listeners {
  private val changes = HashMap<String, HashMap<UUID, (Change) -> Unit>>()
  private val statuses = HashMap<String, HashMap<UUID, (Status) -> Unit>>()

  fun addChange(handle: String, callback: (Change) -> Unit): () -> Unit {
    val id = UUID.randomUUID()
    changes.getOrPut(handle) { HashMap() }[id] = callback

    return { changes[handle]?.remove(id) }
  }

  fun addStatus(handle: String, callback: (Status) -> Unit): () -> Unit {
    val id = UUID.randomUUID()
    statuses.getOrPut(handle) { HashMap() }[id] = callback

    return { statuses[handle]?.remove(id) }
  }

  fun deliverChange(handle: String, change: Change) {
    for (callback in changes[handle]?.values?.toList() ?: emptyList()) {
      callback(change)
    }
  }

  fun deliverStatus(handle: String, status: Status) {
    for (callback in statuses[handle]?.values?.toList() ?: emptyList()) {
      callback(status)
    }
  }
}
