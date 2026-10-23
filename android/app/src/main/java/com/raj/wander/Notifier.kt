package com.raj.wander

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import java.util.Calendar
import kotlin.math.roundToInt

/** Notification channels, the alerts Wander posts, and the two evening reminders (streak 21:00, trip recap 20:30). */
object Notifier {
    const val CH_TRACK = "tracking"
    const val CH_PLACES = "places"
    const val CH_REMIND = "reminders"
    const val ID_TRACK = 1
    private const val ID_STREAK = 2
    private const val ID_RECAP = 3
    private const val ID_TRIP = 4

    fun channels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(NotificationChannel(CH_TRACK, "Exploring (while recording)", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
        nm.createNotificationChannel(NotificationChannel(CH_PLACES, "New places nearby", NotificationManager.IMPORTANCE_DEFAULT))
        nm.createNotificationChannel(NotificationChannel(CH_REMIND, "Streaks and trip recaps", NotificationManager.IMPORTANCE_DEFAULT))
    }

    private fun canPost(ctx: Context) = Build.VERSION.SDK_INT < 33 || ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Opens the app; extras tell the page what to show (a place, the recap, a trip). */
    fun open(ctx: Context, code: Int, extras: Map<String, String> = emptyMap()): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        for ((k, v) in extras) i.putExtra(k, v)
        return PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun serviceAction(ctx: Context, action: String, code: Int, until: Long = 0): PendingIntent {
        val i = Intent(ctx, TrackingService::class.java).setAction(action).putExtra("until", until)
        return PendingIntent.getForegroundService(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** The ongoing notification that shows whenever the tracking service runs. */
    fun ongoing(ctx: Context, title: String, text: String, paused: Boolean): Notification {
        val b = Notification.Builder(ctx, CH_TRACK)
            .setSmallIcon(R.drawable.ic_note)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setContentIntent(open(ctx, 10))
        if (paused) b.addAction(Notification.Action.Builder(null as android.graphics.drawable.Icon?, "RESUME", serviceAction(ctx, TrackingService.ACTION_RESUME, 11)).build())
        else b.addAction(Notification.Action.Builder(null as android.graphics.drawable.Icon?, "PAUSE 1 H", serviceAction(ctx, TrackingService.ACTION_PAUSE, 12, -2)).build())
        b.addAction(Notification.Action.Builder(null as android.graphics.drawable.Icon?, "OPEN MAP", open(ctx, 13)).build())
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        return b.build()
    }

    fun place(ctx: Context, p: Store.Place, dist: Float) {
        if (!canPost(ctx)) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        val n = Notification.Builder(ctx, CH_PLACES)
            .setSmallIcon(R.drawable.ic_note)
            .setContentTitle("New place: ${p.name}")
            .setContentText("${p.cat} · ${(dist / 10).roundToInt() * 10} m")
            .setAutoCancel(true)
            .setContentIntent(open(ctx, 100 + (p.id.hashCode() and 0xffff), mapOf("place" to p.id)))
            .build()
        runCatching { nm.notify(1000 + (p.id.hashCode() and 0xffff), n) }
    }

    fun simple(ctx: Context, id: Int, title: String, text: String, extras: Map<String, String>) {
        if (!canPost(ctx)) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        val n = Notification.Builder(ctx, CH_REMIND)
            .setSmallIcon(R.drawable.ic_note)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .setContentIntent(open(ctx, 200 + id, extras))
            .build()
        runCatching { nm.notify(id, n) }
    }

    fun tripDone(ctx: Context, tripId: String, city: String) {
        if (Store.once(ctx, "tripsDone", tripId)) simple(ctx, ID_TRIP, "Your $city memory lane is ready", "Your trip, day by day, with your favourite photos.", mapOf("screen" to "trip", "trip" to tripId))
    }

    /* ---------- evening reminders ---------- */
    private fun alarm(ctx: Context, kind: String, code: Int): PendingIntent =
        PendingIntent.getBroadcast(ctx, code, Intent(ctx, AlarmReceiver::class.java).putExtra("kind", kind), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun nextAt(h: Int, m: Int): Long {
        val c = Calendar.getInstance()
        c.set(Calendar.HOUR_OF_DAY, h); c.set(Calendar.MINUTE, m); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
        if (c.timeInMillis <= System.currentTimeMillis()) c.add(Calendar.DAY_OF_YEAR, 1)
        return c.timeInMillis
    }

    fun schedule(ctx: Context) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        val streak = alarm(ctx, "streak", 1); val recap = alarm(ctx, "recap", 2)
        am.cancel(streak); am.cancel(recap)
        am.setInexactRepeating(AlarmManager.RTC_WAKEUP, nextAt(21, 0), AlarmManager.INTERVAL_DAY, streak)
        am.setInexactRepeating(AlarmManager.RTC_WAKEUP, nextAt(20, 30), AlarmManager.INTERVAL_DAY, recap)
    }

    fun onAlarm(ctx: Context, kind: String) {
        val st = Store.status(ctx); val notif = st.optJSONObject("notif"); val today = Store.today()
        val pushedToday = st.optString("today") == today
        if (kind == "streak") {
            if (notif?.optBoolean("streak", true) == false) return
            val streak = st.optInt("streak", 0)
            val hasToday = (pushedToday && st.optInt("todayNew", 0) > 0) || Store.newToday(ctx) > 0
            if (streak < 1 || hasToday) return
            val last = Store.last(ctx)
            val closest = last?.let { Hex.closestUnknown(it.getDouble("lat"), it.getDouble("lng"), Store.loadKnown(ctx)) }
            val tail = if (closest != null) " The closest is ${(closest / 10).roundToInt() * 10} m away." else ""
            simple(ctx, ID_STREAK, "Your $streak-day streak ends at midnight", "One new cell keeps it.$tail", emptyMap())
        } else if (kind == "recap") {
            if (notif?.optBoolean("recap", true) == false) return
            val trip = st.optJSONObject("trip") ?: return
            val km = Store.metersToday(ctx) / 1000f
            val places = if (pushedToday) st.optInt("todayPlaces", 0) else 0
            val city = trip.optString("city", "your trip")
            val day = trip.optInt("day", 1)
            simple(ctx, ID_RECAP, "Day $day in $city: $places ${if (places == 1) "place" else "places"}, ${"%.1f".format(km)} km",
                "+${Store.newToday(ctx)} new cells. Star your best photo of the day.", mapOf("screen" to "recap", "day" to today))
        }
    }
}

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        Notifier.onAlarm(ctx, intent.getStringExtra("kind") ?: "streak")
    }
}

/** After a reboot or an update: put the reminders back and, if allowed to track in the background, restart tracking. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        Notifier.schedule(ctx)
        val mode = Store.tracking(ctx)
        if ((mode == "smart" || mode == "always") && TrackingService.hasBackground(ctx)) {
            runCatching { TrackingService.start(ctx) }
        }
    }
}
