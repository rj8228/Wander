package com.raj.wander

import android.content.Context
import android.content.SharedPreferences
import android.location.Location
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * What the native side remembers between the page and the tracking service: recorded points waiting for the page,
 * the quiet places and nearby places the page pushed, today's counters and the pause state.
 */
object Store {
    private const val PREFS = "wander"
    private val lock = Any()

    fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    /* ---------- recorded points: appended by the service, taken by the page ---------- */
    private fun pointsFile(ctx: Context) = File(ctx.filesDir, "points.csv")

    fun appendPoint(ctx: Context, loc: Location) {
        val spd = if (loc.hasSpeed()) loc.speed.toDouble() else -1.0
        val line = "${loc.time},${loc.latitude},${loc.longitude},${loc.accuracy},$spd\n"
        synchronized(lock) {
            val f = pointsFile(ctx)
            if (f.length() < 8_000_000) f.appendText(line)
        }
    }

    /** Returns every waiting point as a JSON array of [time, lat, lng, accuracy, speed] and clears the queue. */
    fun takePoints(ctx: Context): String {
        val lines = synchronized(lock) {
            val f = pointsFile(ctx)
            if (!f.exists()) return "[]"
            val l = f.readLines(); f.delete(); l
        }
        val out = StringBuilder("[")
        var first = true
        for (line in lines) {
            val p = line.split(",")
            if (p.size < 5) continue
            if (!first) out.append(',')
            out.append('[').append(p[0]).append(',').append(p[1]).append(',').append(p[2]).append(',').append(p[3]).append(',').append(p[4]).append(']')
            first = false
        }
        return out.append(']').toString()
    }

    /* ---------- pushed from the page ---------- */
    data class Quiet(val name: String, val lat: Double, val lng: Double, val r: Double)
    data class Place(val id: String, val name: String, val cat: String, val lat: Double, val lng: Double)

    fun put(ctx: Context, key: String, json: String) = prefs(ctx).edit().putString(key, json).apply()

    fun quiet(ctx: Context): List<Quiet> = runCatching {
        val a = JSONArray(prefs(ctx).getString("quiet", "[]"))
        (0 until a.length()).map { a.getJSONObject(it) }.map { Quiet(it.optString("name", "Quiet place"), it.getDouble("lat"), it.getDouble("lng"), it.optDouble("r", 250.0)) }
    }.getOrDefault(emptyList())

    fun nearby(ctx: Context): List<Place> = runCatching {
        val a = JSONArray(prefs(ctx).getString("nearby", "[]"))
        (0 until a.length()).map { a.getJSONObject(it) }.map { Place(it.getString("id"), it.optString("name"), it.optString("cat"), it.getDouble("lat"), it.getDouble("lng")) }
    }.getOrDefault(emptyList())

    fun status(ctx: Context): JSONObject = runCatching { JSONObject(prefs(ctx).getString("status", "{}") ?: "{}") }.getOrDefault(JSONObject())

    fun saveKnown(ctx: Context, json: String) { synchronized(lock) { File(ctx.filesDir, "known.json").writeText(json) } }

    fun loadKnown(ctx: Context): HashSet<Long> = synchronized(lock) {
        val out = HashSet<Long>()
        runCatching {
            val f = File(ctx.filesDir, "known.json")
            if (f.exists()) { val a = JSONArray(f.readText()); for (i in 0 until a.length()) out.add(a.getLong(i)) }
        }
        out
    }

    /* ---------- tracking settings ---------- */
    fun tracking(ctx: Context): String = prefs(ctx).getString("tracking", "off") ?: "off"
    fun setTracking(ctx: Context, mode: String) = prefs(ctx).edit().putString("tracking", mode).apply()
    /** 0 = not paused, -1 = until turned back on, otherwise a time in ms. */
    fun pausedUntil(ctx: Context): Long = prefs(ctx).getLong("paused", 0L)
    fun setPaused(ctx: Context, until: Long) = prefs(ctx).edit().putLong("paused", until).apply()
    fun isPaused(ctx: Context): Boolean { val p = pausedUntil(ctx); return p == -1L || p > System.currentTimeMillis() }

    /* ---------- today's counters for the notifications ---------- */
    private fun rollDay(ctx: Context) {
        val p = prefs(ctx); val d = today()
        if (p.getString("day", "") != d) p.edit().putString("day", d).putInt("newToday", 0).putFloat("mToday", 0f).apply()
    }
    fun newToday(ctx: Context): Int { rollDay(ctx); return prefs(ctx).getInt("newToday", 0) }
    fun metersToday(ctx: Context): Float { rollDay(ctx); return prefs(ctx).getFloat("mToday", 0f) }
    fun addNew(ctx: Context, n: Int) { rollDay(ctx); val p = prefs(ctx); p.edit().putInt("newToday", p.getInt("newToday", 0) + n).apply() }
    fun addMeters(ctx: Context, m: Float) { rollDay(ctx); val p = prefs(ctx); p.edit().putFloat("mToday", p.getFloat("mToday", 0f) + m).apply() }

    fun setLast(ctx: Context, loc: Location) {
        prefs(ctx).edit().putString("last", JSONObject().put("lat", loc.latitude).put("lng", loc.longitude).put("t", loc.time).put("acc", loc.accuracy.toDouble()).toString()).apply()
    }
    fun last(ctx: Context): JSONObject? = prefs(ctx).getString("last", null)?.let { runCatching { JSONObject(it) }.getOrNull() }

    /** Remembers ids we've already notified about (places, trips) so each alert shows once. */
    fun once(ctx: Context, key: String, id: String): Boolean {
        val p = prefs(ctx); val set = (p.getString(key, "") ?: "").split("|").filter { it.isNotEmpty() }.toMutableList()
        if (set.contains(id)) return false
        set.add(id); while (set.size > 400) set.removeAt(0)
        p.edit().putString(key, set.joinToString("|")).apply()
        return true
    }

    fun reset(ctx: Context) {
        synchronized(lock) { pointsFile(ctx).delete(); File(ctx.filesDir, "known.json").delete() }
        prefs(ctx).edit().clear().apply()
    }
}
