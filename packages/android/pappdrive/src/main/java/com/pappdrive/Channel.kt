package com.pappdrive

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** The host side of the pappdrive RPC envelope over one text transport: sends requests and replies, receives the engine's requests, replies and notifications. Main thread only. */
internal class Channel {
  private var nextId = 1
  private val pending = HashMap<Int, (Result<Any?>) -> Unit>()
  private val handlers = HashMap<String, suspend (JSONObject) -> Any?>()
  private val scope = CoroutineScope(Dispatchers.Main.immediate)
  private var closed: PappException? = null
  var send: (String) -> Unit = {}

  suspend fun request(method: String, params: JSONObject): Any? {
    closed?.let { throw it }
    val id = nextId++

    return suspendCancellableCoroutine { continuation ->
      pending[id] = { result -> result.fold({ continuation.resume(it) }, { continuation.resumeWithException(it) }) }
      send(JSONObject().put("id", id).put("method", method).put("params", params).toString())
    }
  }

  fun requestWithoutReply(method: String, params: JSONObject) {
    send(JSONObject().put("id", nextId++).put("method", method).put("params", params).toString())
  }

  fun on(method: String, handler: suspend (JSONObject) -> Any?) {
    handlers[method] = handler
  }

  fun receive(text: String) {
    val message = JSONObject(text)

    if (message.has("method")) {
      val method = message.getString("method")
      val handler = handlers[method]
      val id = if (message.has("id")) message.getInt("id") else null

      if (handler == null) {
        if (id != null) {
          send(reply(id, PappException("bad-request", "bad-request: Unknown method \"$method\".")))
        }

        return
      }

      scope.launch {
        if (id == null) {
          handler(message.getJSONObject("params"))

          return@launch
        }

        send(
          runCatching { handler(message.getJSONObject("params")) }.fold(
            { JSONObject().put("id", id).put("ok", true).put("value", it ?: JSONObject.NULL).toString() },
            { reply(id, it as? PappException ?: PappException("internal", it.toString())) },
          ),
        )
      }

      return
    }

    val waiting = pending.remove(message.getInt("id")) ?: return

    if (message.getBoolean("ok")) {
      waiting(Result.success(message.opt("value")))
    } else {
      waiting(Result.failure(PappException.from(message.getJSONObject("error"))))
    }
  }

  fun close(error: PappException) {
    closed = error
    failAll(error)
  }

  fun failAll(error: PappException) {
    val waiting = pending.values.toList()
    pending.clear()

    for (resume in waiting) {
      resume(Result.failure(error))
    }
  }

  private fun reply(id: Int, error: PappException): String {
    val body = JSONObject().put("code", error.code).put("message", error.message)
    error.retryAfter?.let { body.put("retryAfter", it) }
    error.reason?.let { body.put("reason", it) }

    return JSONObject().put("id", id).put("ok", false).put("error", body).toString()
  }
}
