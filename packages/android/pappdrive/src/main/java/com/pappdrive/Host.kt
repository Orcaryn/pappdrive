package com.pappdrive

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject

/** Runs the pappdrive engine in a WebView that is never shown and carries the RPC envelope across the JavaScript bridge. */
@SuppressLint("SetJavaScriptEnabled")
internal class Host(context: Context, server: String, app: String, read: List<String>, keyStore: KeyStore, private val syncOnBackground: Boolean) {
  val channel = Channel()
  private val appContext = context.applicationContext
  private val main = Handler(Looper.getMainLooper())
  private var ready = false
  private val queued = ArrayList<String>()
  val reopens = HashMap<String, Pair<String, JSONObject>>()
  private val assets = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(appContext)).build()
  private val start = """
    try {
      pappdrive.start(${JSONObject().put("server", server).put("app", app).put("read", JSONArray(read)).put("syncOnBackground", syncOnBackground)}, text => host.postMessage(text));
      host.postMessage('{"method":"host.ready","params":{}}');
    } catch (e) {
      host.postMessage(JSON.stringify({ method: 'host.failed', params: { message: String(e) } }));
    }
  """.trimIndent()
  private val client = object : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = assets.shouldInterceptRequest(request.url)

    override fun onPageFinished(view: WebView, url: String) {
      view.evaluateJavascript(start, null)
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
      if (request.isForMainFrame) {
        error("pappdrive: the engine page did not load: ${error.description}")
      }
    }

    // Android: a WebView whose render process is gone cannot be used again; it must be destroyed and replaced.
    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
      view.destroy()
      ready = false
      queued.clear()
      channel.failAll(PappException("restarted", "restarted: Android stopped the sync engine. It is starting again and reopens the folders; try again."))

      for ((method, params) in reopens.values) {
        channel.requestWithoutReply(method, params)
      }

      webView = createWebView()

      return true
    }
  }
  private val background = LifecycleEventObserver { _, event ->
    if (event == Lifecycle.Event.ON_STOP) {
      channel.requestWithoutReply("host.background", JSONObject())
    }
  }
  private var webView: WebView

  init {
    channel.send = { text -> main.post { deliver(text) } }
    channel.on("host.ready") { becameReady() }
    channel.on("host.failed") { error("pappdrive: the engine did not start: ${it.getString("message")}") }
    channel.on("host.keystore.get") { keyStore.get(it.getString("name")) }
    channel.on("host.keystore.set") { keyStore.set(it.getString("name"), it.getString("value")) }
    channel.on("host.keystore.delete") { keyStore.delete(it.getString("name")) }

    if (syncOnBackground) {
      ProcessLifecycleOwner.get().lifecycle.addObserver(background)
    }

    webView = createWebView()
  }

  fun release() {
    if (syncOnBackground) {
      ProcessLifecycleOwner.get().lifecycle.removeObserver(background)
    }

    channel.close(PappException("released", "released: Pappdrive.release() stopped this engine."))
    webView.destroy()
  }

  private fun createWebView(): WebView = WebView(appContext).apply {
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = true
    addJavascriptInterface(Bridge(), "host")
    webViewClient = client
    loadUrl(PAGE)
  }

  private fun deliver(text: String) {
    if (!ready) {
      queued.add(text)

      return
    }

    webView.evaluateJavascript("pappdrive.receive(${JSONObject.quote(text)})", null)
  }

  private fun becameReady() {
    ready = true
    val texts = queued.toList()
    queued.clear()

    for (text in texts) {
      deliver(text)
    }
  }

  private inner class Bridge {
    @JavascriptInterface
    fun postMessage(text: String) {
      main.post { channel.receive(text) }
    }
  }

  private companion object {
    // WebViewAssetLoader serves the app's assets from an https origin, which OPFS and WebCrypto require.
    const val PAGE = "https://appassets.androidplatform.net/assets/index.html"
  }
}
