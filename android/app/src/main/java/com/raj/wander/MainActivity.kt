package com.raj.wander

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.Toast
import androidx.core.content.FileProvider
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Wander on Android: the same web app, served offline from the APK's assets on a virtual https origin
 * (so storage, IndexedDB and the tile cache work), plus a bridge (window.WanderNative) for what a page can't do:
 * background location through TrackingService, notifications, the camera, the gallery, and the share sheet.
 */
class MainActivity : Activity() {

    companion object {
        private const val HOST = "appassets.androidplatform.net"
        private const val HOME = "https://$HOST/assets/index.html"
        private const val REQ_FILE = 7
        private const val REQ_CAMERA = 8
        private const val REQ_PERMS = 9
    }

    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private lateinit var loader: WebViewAssetLoader
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPhoto: Uri? = null
    private val captured = ArrayList<String>()
    @Volatile private var launch: JSONObject? = null
    private var insetTop = 0
    private var insetBottom = 0
    private var pageReady = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        loader = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        // If a service worker was ever registered, route its requests to the APK's files too, so it can never
        // serve stale code after an update (the page then removes it).
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(object : ServiceWorkerClientCompat() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? = loader.shouldInterceptRequest(request.url)
            })
        }
        web = WebView(this)
        root = FrameLayout(this)
        root.addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)
        edgeToEdge()

        val ver = packageManager.getPackageInfo(packageName, 0).versionName ?: ""
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = true // the file chooser hands camera photos back as content:// URIs
            setGeolocationEnabled(false) // location comes from the service, through the bridge
            userAgentString = "$userAgentString Wander/$ver (com.raj.wander)"
        }
        web.addJavascriptInterface(Bridge(), "WanderNative")
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean =
                chooseFile(callback, params)
        }
        web.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == HOST) return false
                openExternal(request.url)
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                pageReady = true
                pushInsets()
            }
        }
        // A new install of the app: drop the HTTP cache so every file is read fresh (saved data is kept).
        val prefs = getSharedPreferences("wander-app", MODE_PRIVATE)
        if (prefs.getString("ver", "") != ver) { web.clearCache(true); prefs.edit().putString("ver", ver).apply() }
        readLaunch(intent)
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(HOME)
        Notifier.channels(this)
        Notifier.schedule(this)
    }

    /* ---------- edge to edge: the page draws under the bars and gets their sizes as CSS variables ---------- */
    private fun edgeToEdge() {
        if (Build.VERSION.SDK_INT < 30) return
        window.setDecorFitsSystemWindows(false)
        @Suppress("DEPRECATION")
        window.statusBarColor = Color.TRANSPARENT
        @Suppress("DEPRECATION")
        window.navigationBarColor = Color.TRANSPARENT
        root.setOnApplyWindowInsetsListener { v, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars())
            val ime = insets.getInsets(WindowInsets.Type.ime())
            val d = resources.displayMetrics.density
            v.setPadding(0, 0, 0, if (ime.bottom > bars.bottom) ime.bottom else 0) // keep inputs above the keyboard
            insetTop = (bars.top / d).toInt()
            insetBottom = if (ime.bottom > bars.bottom) 0 else (bars.bottom / d).toInt()
            pushInsets()
            insets
        }
    }

    private fun pushInsets() {
        if (!pageReady || Build.VERSION.SDK_INT < 30) return
        web.evaluateJavascript("(function(s){s.setProperty('--sat','${insetTop}px');s.setProperty('--sab','${insetBottom}px')})(document.documentElement.style)", null)
    }

    private fun setBars(dark: Boolean) {
        if (Build.VERSION.SDK_INT >= 30) {
            val light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(if (dark) 0 else light, light)
        } else {
            @Suppress("DEPRECATION")
            window.statusBarColor = if (dark) Color.parseColor("#151B27") else Color.parseColor("#F4F5F7")
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (dark) 0 else View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        }
    }

    /* ---------- launches: compare links and notification taps ---------- */
    private fun readLaunch(i: Intent?) {
        if (i == null) return
        val o = JSONObject()
        i.data?.let { o.put("link", it.toString()) }
        for (k in listOf("place", "screen", "day", "trip")) i.getStringExtra(k)?.let { o.put(k, it) }
        if (o.length() > 0) launch = o
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        readLaunch(intent)
        if (pageReady) web.evaluateJavascript("window.wanderLaunch && window.wanderLaunch()", null)
    }

    override fun onResume() {
        super.onResume()
        if (Store.tracking(this) == "open" && TrackingService.hasLocation(this)) runCatching { TrackingService.start(this) }
        if (pageReady) web.evaluateJavascript("window.wanderOnPermission && window.wanderOnPermission(); window.wanderLaunch && window.wanderLaunch()", null)
    }

    override fun onStop() {
        super.onStop()
        if (Store.tracking(this) == "open") TrackingService.stop(this)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    /* ---------- files: camera for <input capture>, a picker otherwise ---------- */
    private fun chooseFile(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
        fileCallback?.onReceiveValue(null)
        fileCallback = callback
        val image = params.acceptTypes.any { it.startsWith("image") }
        if (image && params.isCaptureEnabled) {
            val uri = newPhotoUri()
            if (uri != null) {
                pendingPhoto = uri
                val cam = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                    .putExtra(MediaStore.EXTRA_OUTPUT, uri)
                    .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                cam.clipData = ClipData.newRawUri("photo", uri)
                try { startActivityForResult(cam, REQ_CAMERA); return true } catch (e: ActivityNotFoundException) { dropPending() }
            }
        }
        val pick = Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType(if (image) "image/*" else "*/*")
        return try { startActivityForResult(pick, REQ_FILE); true } catch (e: ActivityNotFoundException) { fileCallback = null; false }
    }

    /** A new gallery entry in Pictures/Wander (Android 10+), or a private file on older phones. */
    private fun newPhotoUri(): Uri? = runCatching {
        val name = "Wander_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date()) + ".jpg"
        if (Build.VERSION.SDK_INT >= 29) {
            val v = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, name)
                put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Wander")
            }
            contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v)
        } else {
            val dir = File(getExternalFilesDir(Environment.DIRECTORY_PICTURES), "").apply { mkdirs() }
            FileProvider.getUriForFile(this, "$packageName.files", File(dir, name))
        }
    }.getOrNull()

    private fun dropPending() {
        val u = pendingPhoto ?: return
        if (Build.VERSION.SDK_INT >= 29) runCatching { contentResolver.delete(u, null, null) }
        pendingPhoto = null
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQ_CAMERA -> {
                val u = pendingPhoto
                if (resultCode == RESULT_OK && u != null) {
                    synchronized(captured) { captured.add(u.toString()) }
                    fileCallback?.onReceiveValue(arrayOf(u))
                    pendingPhoto = null
                } else {
                    dropPending(); fileCallback?.onReceiveValue(null)
                }
                fileCallback = null
            }
            REQ_FILE -> {
                val uri = if (resultCode == RESULT_OK) data?.data else null
                fileCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
                fileCallback = null
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (permissions.contains(Manifest.permission.ACCESS_BACKGROUND_LOCATION) && TrackingService.hasBackground(this)) Notifier.schedule(this)
        web.evaluateJavascript("window.wanderOnPermission && window.wanderOnPermission()", null)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript("window.wanderBack ? window.wanderBack() : 'none'") { r ->
            if (r?.contains("closed") != true) { if (web.canGoBack()) web.goBack() else moveTaskToBack(true) }
        }
    }

    private fun openExternal(uri: Uri) {
        try { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
        catch (e: ActivityNotFoundException) { Toast.makeText(this, "No app can open that link", Toast.LENGTH_SHORT).show() }
    }

    private fun granted(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    private fun shareFile(png: ByteArray): Uri {
        val dir = File(cacheDir, "share").apply { mkdirs() }
        val f = File(dir, "wander-card.png"); f.writeBytes(png)
        return FileProvider.getUriForFile(this, "$packageName.files", f)
    }

    inner class Bridge {
        @JavascriptInterface
        fun permissions(): String = JSONObject()
            .put("fine", granted(Manifest.permission.ACCESS_FINE_LOCATION))
            .put("coarse", granted(Manifest.permission.ACCESS_COARSE_LOCATION))
            .put("background", TrackingService.hasBackground(this@MainActivity))
            .put("notify", Build.VERSION.SDK_INT < 33 || granted(Manifest.permission.POST_NOTIFICATIONS))
            .put("sdk", Build.VERSION.SDK_INT).toString()

        /** kind: location | background | notifications. The page hears back through window.wanderOnPermission(). */
        @JavascriptInterface
        fun requestPermission(kind: String): Boolean {
            val perms = when (kind) {
                "location" -> arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                "background" -> if (Build.VERSION.SDK_INT >= 29) arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION) else emptyArray()
                "notifications" -> if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.POST_NOTIFICATIONS) else emptyArray()
                else -> emptyArray()
            }
            if (perms.isEmpty() || perms.all { granted(it) }) return false
            runOnUiThread { requestPermissions(perms, REQ_PERMS) }
            return true
        }

        /** mode: smart | always | open | off */
        @JavascriptInterface
        fun startTracking(mode: String) {
            Store.setTracking(this@MainActivity, mode)
            runOnUiThread {
                if (mode == "off") TrackingService.stop(this@MainActivity)
                else if (TrackingService.hasLocation(this@MainActivity)) runCatching { TrackingService.start(this@MainActivity, TrackingService.ACTION_REFRESH) }
            }
        }

        @JavascriptInterface
        fun pause(until: String) {
            val u = until.toLongOrNull() ?: 0L
            Store.setPaused(this@MainActivity, u)
            runOnUiThread {
                if (TrackingService.running || u == 0L) runCatching { TrackingService.start(this@MainActivity, if (u == 0L) TrackingService.ACTION_RESUME else TrackingService.ACTION_PAUSE, u) }
            }
        }

        @JavascriptInterface
        fun takePoints(): String = Store.takePoints(this@MainActivity)

        @JavascriptInterface
        fun status(): String = JSONObject()
            .put("running", TrackingService.running)
            .put("mode", TrackingService.mode)
            .put("pausedUntil", Store.pausedUntil(this@MainActivity))
            .put("newToday", Store.newToday(this@MainActivity))
            .put("kmToday", Store.metersToday(this@MainActivity) / 1000.0)
            .put("last", Store.last(this@MainActivity) ?: JSONObject.NULL)
            .put("perms", JSONObject(permissions())).toString()

        @JavascriptInterface
        fun setQuietPlaces(json: String) { Store.put(this@MainActivity, "quiet", json); if (TrackingService.running) runOnUiThread { runCatching { TrackingService.start(this@MainActivity, TrackingService.ACTION_REFRESH) } } }

        @JavascriptInterface
        fun setNearbyPlaces(json: String) = Store.put(this@MainActivity, "nearby", json)

        @JavascriptInterface
        fun setKnownCells(json: String) { Store.saveKnown(this@MainActivity, json); TrackingService.knownDirty = true }

        @JavascriptInterface
        fun setStatus(json: String) = Store.put(this@MainActivity, "status", json)

        @JavascriptInterface
        fun takeLaunch(): String { val l = launch; launch = null; return l?.toString() ?: "null" }

        @JavascriptInterface
        fun takeCaptured(): String = synchronized(captured) { val a = JSONArray(captured); captured.clear(); a.toString() }

        @JavascriptInterface
        fun setTheme(dark: Boolean) = runOnUiThread { setBars(dark) }

        @JavascriptInterface
        fun openUrl(url: String) = runOnUiThread { openExternal(Uri.parse(url)) }

        @JavascriptInterface
        fun openAppSettings() = runOnUiThread {
            runCatching { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) }
        }

        @JavascriptInterface
        fun openMedia(uri: String) = runOnUiThread {
            runCatching { startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(uri), "image/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)) }
        }

        @JavascriptInterface
        fun share(text: String) = runOnUiThread {
            val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }
            startActivity(Intent.createChooser(send, "Share"))
        }

        /** Shares the card PNG. target: stories (Instagram), whatsapp, or anything else for the system sheet. */
        @JavascriptInterface
        fun shareImage(b64: String, text: String, target: String) = runOnUiThread {
            try {
                val uri = shareFile(Base64.decode(b64, Base64.DEFAULT))
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "image/png"; putExtra(Intent.EXTRA_STREAM, uri); putExtra(Intent.EXTRA_TEXT, text)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION); clipData = ClipData.newRawUri("card", uri)
                }
                val pkg = when (target) { "whatsapp" -> "com.whatsapp"; "stories" -> "com.instagram.android"; else -> null }
                if (pkg != null) {
                    try { startActivity(Intent(send).setPackage(pkg)); return@runOnUiThread } catch (e: ActivityNotFoundException) { /* not installed */ }
                }
                startActivity(Intent.createChooser(send, "Share your map"))
            } catch (e: Exception) {
                Toast.makeText(this@MainActivity, "Couldn't share the card", Toast.LENGTH_SHORT).show()
            }
        }

        /** Saves the card PNG to the gallery (Pictures/Wander). */
        @JavascriptInterface
        fun saveImage(b64: String, name: String) = runOnUiThread {
            try {
                val bytes = Base64.decode(b64, Base64.DEFAULT)
                if (Build.VERSION.SDK_INT >= 29) {
                    val v = ContentValues().apply {
                        put(MediaStore.Images.Media.DISPLAY_NAME, name)
                        put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                        put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Wander")
                    }
                    val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v)
                    if (uri != null) contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                    Toast.makeText(this@MainActivity, "Saved to your gallery", Toast.LENGTH_SHORT).show()
                } else {
                    shareImage(b64, "", "")
                }
            } catch (e: Exception) {
                Toast.makeText(this@MainActivity, "Couldn't save the card", Toast.LENGTH_SHORT).show()
            }
        }

        /** Saves a text file (the backup) to Downloads. */
        @JavascriptInterface
        fun saveFile(name: String, text: String) = runOnUiThread {
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    val v = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, name)
                        put(MediaStore.Downloads.MIME_TYPE, "application/json")
                    }
                    val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v)
                    if (uri != null) contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) }
                    Toast.makeText(this@MainActivity, "Saved $name to Downloads", Toast.LENGTH_LONG).show()
                } else {
                    share(text)
                }
            } catch (e: Exception) {
                Toast.makeText(this@MainActivity, "Couldn't save the backup", Toast.LENGTH_SHORT).show()
            }
        }

        /** Delete all data: stop tracking and forget everything native-side too. */
        @JavascriptInterface
        fun reset() {
            TrackingService.stop(this@MainActivity)
            Store.reset(this@MainActivity)
        }
    }
}
