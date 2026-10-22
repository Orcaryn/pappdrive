package com.pappdrive

import org.json.JSONObject

class PappException(val code: String, message: String, val retryAfter: Double? = null, val reason: String? = null) : Exception(message) {
  internal companion object {
    fun from(json: JSONObject) = PappException(
      json.getString("code"),
      json.getString("message"),
      if (json.has("retryAfter")) json.getDouble("retryAfter") else null,
      if (json.has("reason")) json.getString("reason") else null,
    )
  }
}

data class FileInfo(val path: String, val size: Long, val mtime: Double, val dir: Boolean) {
  internal companion object {
    fun from(json: JSONObject) = FileInfo(json.getString("path"), json.getLong("size"), json.getDouble("mtime"), json.getBoolean("dir"))
  }
}

data class Change(val path: String, val origin: String, val copy: String?, val reason: String?) {
  internal companion object {
    fun from(json: JSONObject) = Change(
      json.getString("path"),
      json.getString("origin"),
      if (json.has("copy")) json.getString("copy") else null,
      if (json.has("reason")) json.getString("reason") else null,
    )
  }
}

data class Status(val syncing: Boolean, val lastSync: Double?, val pending: Int, val skipped: List<String>, val deleted: String?, val error: String?) {
  internal companion object {
    fun from(json: JSONObject): Status {
      val skipped = json.getJSONArray("skipped")

      return Status(
        json.getBoolean("syncing"),
        if (json.isNull("lastSync")) null else json.getDouble("lastSync"),
        json.getInt("pending"),
        List(skipped.length()) { skipped.getString(it) },
        if (json.isNull("deleted")) null else json.getString("deleted"),
        if (json.isNull("error")) null else json.getString("error"),
      )
    }
  }
}

data class PendingSignUp(val email: String, val recoveryCode: String)
