package com.raj.wander

import android.Manifest
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.location.LocationRequest
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import java.util.Calendar

/**
 * Records where you walk and drive, with the screen off, into app storage for the page to pick up.
 * Battery-sensible: GPS at full rate only while you're out and moving; low-power fixes inside a quiet place
 * (just enough to notice you've left) and after 10 minutes without moving. Always shows an ongoing notification.
 */
class TrackingService : Service(), LocationListener {

    companion object {
        const val ACTION_START = "com.raj.wander.START"
        const val ACTION_PAUSE = "com.raj.wander.PAUSE"
        const val ACTION_RESUME = "com.raj.wander.RESUME"
        const val ACTION_STOP = "com.raj.wander.STOP"
        const val ACTION_REFRESH = "com.raj.wander.REFRESH"
        private const val STILL_MS = 10 * 60 * 1000L
        private const val LEFT_NOTE_MS = 10 * 60 * 1000L

        @Volatile var running = false
        @Volatile var mode = "off" // active | quiet | still | paused | off
        @Volatile var knownDirty = true

        fun hasLocation(ctx: Context) = ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

        fun hasBackground(ctx: Context) = hasLocation(ctx) &&
            (Build.VERSION.SDK_INT < 29 || ctx.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED)

        fun start(ctx: Context, action: String = ACTION_START, until: Long = 0) {
            val i = Intent(ctx, TrackingService::class.java).setAction(action).putExtra("until", until)
            ctx.startForegroundService(i)
        }

        fun stop(ctx: Context) {
            if (running) runCatching { ctx.startService(Intent(ctx, TrackingService::class.java).setAction(ACTION_STOP)) }
        }
    }

    private lateinit var lm: LocationManager
    private val handler = Handler(Looper.getMainLooper())
    private var requested: String? = null
    private var known = HashSet<Long>()
    private var anchor: Location? = null
    private var lastRecorded: Location? = null
    private var leftAt = 0L
    private var leftName = ""
    private var lastNoteText = ""
    private var lastNoteAt = 0L
    private val resume = Runnable { Store.setPaused(this, 0); applyMode() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        lm = getSystemService(LocationManager::class.java)
        Notifier.channels(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Every start must promote to foreground right away, even if we stop again just after.
        try {
            val n = Notifier.ongoing(this, "Wander", "Starting…", false)
            if (Build.VERSION.SDK_INT >= 29) startForeground(Notifier.ID_TRACK, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            else startForeground(Notifier.ID_TRACK, n)
        } catch (e: Exception) {
            stopSelf(); return START_NOT_STICKY
        }
        when (intent?.action) {
            ACTION_STOP -> { shutdown(); return START_NOT_STICKY }
            ACTION_PAUSE -> {
                val u = intent.getLongExtra("until", 0L)
                Store.setPaused(this, if (u == -2L) System.currentTimeMillis() + 3600_000L else u)
            }
            ACTION_RESUME -> Store.setPaused(this, 0)
        }
        if (!hasLocation(this) || Store.tracking(this) == "off") { shutdown(); return START_NOT_STICKY }
        running = true
        applyMode()
        return START_STICKY
    }

    private fun shutdown() {
        running = false; mode = "off"
        runCatching { lm.removeUpdates(this) }
        requested = null
        handler.removeCallbacksAndMessages(null)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        running = false; mode = "off"
        runCatching { lm.removeUpdates(this) }
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun quietAt(lat: Double, lng: Double): Store.Quiet? =
        Store.quiet(this).firstOrNull { Hex.distance(lat, lng, it.lat, it.lng) <= it.r }

    private fun applyMode() {
        handler.removeCallbacks(resume)
        val paused = Store.pausedUntil(this)
        if (paused == -1L || paused > System.currentTimeMillis()) {
            mode = "paused"; request(null)
            if (paused > 0) handler.postDelayed(resume, paused - System.currentTimeMillis() + 500)
            updateNote(true); return
        }
        val last = Store.last(this)
        val q = if (last != null && Store.tracking(this) == "smart") quietAt(last.getDouble("lat"), last.getDouble("lng")) else null
        mode = when {
            q != null -> "quiet"
            mode == "still" -> "still"
            else -> "active"
        }
        request(if (mode == "active") "high" else "low")
        updateNote(true)
    }

    /** Switches between full-rate GPS ("high"), occasional low-power fixes ("low") and nothing (null). */
    private fun request(level: String?) {
        if (requested == level) return
        runCatching { lm.removeUpdates(this) }
        requested = null
        if (level == null) return
        val high = level == "high"
        try {
            if (Build.VERSION.SDK_INT >= 31 && lm.hasProvider(LocationManager.FUSED_PROVIDER)) {
                val req = LocationRequest.Builder(if (high) 4000L else 90_000L)
                    .setQuality(if (high) LocationRequest.QUALITY_HIGH_ACCURACY else LocationRequest.QUALITY_BALANCED_POWER_ACCURACY)
                    .setMinUpdateDistanceMeters(if (high) 5f else 40f)
                    .build()
                lm.requestLocationUpdates(LocationManager.FUSED_PROVIDER, req, mainExecutor, this)
            } else if (high) {
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 4000L, 5f, this, Looper.getMainLooper())
            } else {
                val p = if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) LocationManager.NETWORK_PROVIDER else LocationManager.GPS_PROVIDER
                lm.requestLocationUpdates(p, 90_000L, 40f, this, Looper.getMainLooper())
            }
            requested = level
        } catch (e: SecurityException) {
            shutdown()
        } catch (e: IllegalArgumentException) {
            // provider missing on this device; try plain GPS
            runCatching { lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, if (high) 4000L else 90_000L, 5f, this, Looper.getMainLooper()); requested = level }
        }
    }

    override fun onLocationChanged(loc: Location) {
        Store.setLast(this, loc)
        if (Store.isPaused(this)) return
        val now = System.currentTimeMillis()
        val trk = Store.tracking(this)
        val q = if (trk == "smart") quietAt(loc.latitude, loc.longitude) else null
        if (q != null) {
            if (mode != "quiet") { mode = "quiet"; anchor = null; lastRecorded = null; request("low"); updateNote(true) }
            tripHomeCheck(loc)
            return
        }
        if (mode == "quiet") { leftAt = now; leftName = Store.quiet(this).minByOrNull { Hex.distance(loc.latitude, loc.longitude, it.lat, it.lng) }?.name ?: "home"; mode = "active"; request("high") }
        // stopped for 10 minutes: drop to low power until you move again
        val a = anchor
        if (a == null || loc.distanceTo(a) > (if (mode == "still") 80f else 40f)) {
            anchor = loc
            if (mode == "still") { mode = "active"; request("high") }
        } else if (mode == "active" && loc.time - a.time > STILL_MS) {
            mode = "still"; request("low"); updateNote(true)
        }
        // record for the page
        val prev = lastRecorded
        if (loc.accuracy <= 100f && (prev == null || loc.distanceTo(prev) >= 8f || loc.time - prev.time >= 30_000L)) {
            Store.appendPoint(this, loc)
            if (prev != null && loc.time - prev.time < 15 * 60_000L && loc.accuracy <= 50f) Store.addMeters(this, loc.distanceTo(prev))
            lastRecorded = loc
        }
        // count new cells for the notification
        if (loc.accuracy <= 65f) {
            if (knownDirty) { known = Store.loadKnown(this); knownDirty = false }
            val driving = loc.hasSpeed() && loc.speed > 3.2f
            var n = 0
            for (k in Hex.cellsNear(loc.latitude, loc.longitude, Hex.radius(loc.latitude, driving))) if (known.add(k)) n++
            if (n > 0) Store.addNew(this, n)
        }
        checkPlaces(loc)
        tripHomeCheck(loc)
        updateNote(false)
    }

    private fun checkPlaces(loc: Location) {
        val notif = Store.status(this).optJSONObject("notif")
        if (notif?.optBoolean("place", true) == false) return
        for (p in Store.nearby(this)) {
            val d = FloatArray(1)
            Location.distanceBetween(loc.latitude, loc.longitude, p.lat, p.lng, d)
            if (d[0] <= 150f && Store.once(this, "placesSeen", p.id)) Notifier.place(this, p, d[0])
        }
    }

    /** Back within 30 km of home while a trip is on: the memory lane is ready. */
    private fun tripHomeCheck(loc: Location) {
        val st = Store.status(this)
        val trip = st.optJSONObject("trip") ?: return
        val home = st.optJSONObject("home") ?: return
        if (Hex.distance(loc.latitude, loc.longitude, home.optDouble("lat"), home.optDouble("lng")) < 30_000) Notifier.tripDone(this, trip.optString("id"), trip.optString("city", "trip"))
    }

    private fun updateNote(force: Boolean) {
        val now = System.currentTimeMillis()
        val (title, text) = when (mode) {
            "paused" -> {
                val p = Store.pausedUntil(this)
                val until = if (p == -1L) "you turn it back on" else {
                    val c = Calendar.getInstance().apply { timeInMillis = p }
                    val today = Calendar.getInstance()
                    (if (c.get(Calendar.DAY_OF_YEAR) != today.get(Calendar.DAY_OF_YEAR)) "tomorrow " else "") + "%02d:%02d".format(c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE))
                }
                Pair("Paused until $until", "Nothing is recorded while paused")
            }
            "quiet" -> Pair("At a quiet place · GPS off", "Tracking turns on when you leave")
            "still" -> Pair("Resting · GPS off", "Tracking resumes when you move")
            else -> if (leftAt > 0 && now - leftAt < LEFT_NOTE_MS) Pair("You left $leftName · exploring is on", "Off again when you're back, or when you stop for 10 min")
            else {
                val n = Store.newToday(this)
                val km = Store.metersToday(this) / 1000f
                val last = Store.last(this)
                val nearby = if (last == null) 0 else Store.nearby(this).count { Hex.distance(last.getDouble("lat"), last.getDouble("lng"), it.lat, it.lng) < 1000 }
                Pair("Exploring · $n new ${if (n == 1) "cell" else "cells"}", "${"%.1f".format(km)} km today" + if (nearby > 0) " · $nearby ${if (nearby == 1) "place" else "places"} nearby" else "")
            }
        }
        val key = "$title|$text"
        if (!force && (key == lastNoteText || now - lastNoteAt < 15_000L)) return
        lastNoteText = key; lastNoteAt = now
        val nm = getSystemService(android.app.NotificationManager::class.java) ?: return
        runCatching { nm.notify(Notifier.ID_TRACK, Notifier.ongoing(this, title, text, mode == "paused")) }
    }

    // Android 8-10 call these; newer versions have defaults.
    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}
}
