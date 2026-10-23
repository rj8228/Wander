package com.raj.wander

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * The same hex grid as core.js: pointy-top hexagons on the Web-Mercator plane, 55 Mercator metres circumradius,
 * keys packed as (r + 2^19) * 2^20 + (q + 2^19). Used to count new cells for the tracking notification and to find
 * the closest unexplored cell for the streak reminder. Must stay in step with core.js.
 */
object Hex {
    private const val R = 6378137.0
    const val SIZE = 55.0
    private val SQ3 = sqrt(3.0)
    private const val OFF = 524288L
    private const val W = 1048576L

    private fun clampLat(lat: Double) = lat.coerceIn(-85.05, 85.05)
    fun mx(lng: Double) = R * Math.toRadians(lng)
    fun my(lat: Double) = R * ln(tan(PI / 4 + Math.toRadians(clampLat(lat)) / 2))
    private fun latOf(y: Double) = Math.toDegrees(2 * atan(exp(y / R)) - PI / 2)
    private fun lngOf(x: Double) = Math.toDegrees(x / R)

    /** JavaScript's Math.round: floor(x + 0.5). */
    private fun jsRound(v: Double) = floor(v + 0.5)

    private fun axial(x: Double, y: Double): Pair<Long, Long> {
        val qf = (SQ3 / 3 * x - y / 3) / SIZE
        val rf = (2.0 / 3 * y) / SIZE
        val sf = -qf - rf
        var q = jsRound(qf); var r = jsRound(rf); val s = jsRound(sf)
        val dq = abs(q - qf); val dr = abs(r - rf); val ds = abs(s - sf)
        if (dq > dr && dq > ds) q = -r - s else if (dr > ds) r = -q - s
        return Pair(q.toLong(), r.toLong())
    }

    fun pack(q: Long, r: Long) = (r + OFF) * W + (q + OFF)

    private fun centre(q: Long, r: Long) = Pair(SIZE * SQ3 * (q + r / 2.0), SIZE * 1.5 * r)

    fun latLngOf(key: Long): Pair<Double, Double> {
        val rr = Math.floorDiv(key, W)
        val q = key - rr * W - OFF
        val c = centre(q, rr - OFF)
        return Pair(latOf(c.second), lngOf(c.first))
    }

    /** Cells whose centre is within [m] ground metres of a point, always including the point's own cell. */
    fun cellsNear(lat: Double, lng: Double, m: Double): List<Long> {
        val x = mx(lng); val y = my(lat)
        val rm = m / cos(Math.toRadians(clampLat(lat))); val rm2 = rm * rm
        val (q0, r0) = axial(x, y)
        val out = ArrayList<Long>(); out.add(pack(q0, r0))
        val rmin = floor((y - rm) / (SIZE * 1.5)).toLong(); val rmax = ceil((y + rm) / (SIZE * 1.5)).toLong()
        for (r in rmin..rmax) {
            val qmin = floor((x - rm) / (SIZE * SQ3) - r / 2.0).toLong(); val qmax = ceil((x + rm) / (SIZE * SQ3) - r / 2.0).toLong()
            for (q in qmin..qmax) {
                val c = centre(q, r); val dx = c.first - x; val dy = c.second - y
                if (dx * dx + dy * dy <= rm2 && !(q == q0 && r == r0)) out.add(pack(q, r))
            }
        }
        return out
    }

    /** Reveal radius in ground metres for a mode, matching app.js (grid units x hex size x cos(latitude)). */
    fun radius(lat: Double, driving: Boolean) = (if (driving) 0.75 else 1.55) * SIZE * cos(Math.toRadians(lat))

    fun distance(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1); val dLng = Math.toRadians(lng2 - lng1)
        val s = Math.sin(dLat / 2).let { it * it } + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * Math.sin(dLng / 2).let { it * it }
        return 2 * 6371008.0 * Math.asin(sqrt(s.coerceAtMost(1.0)))
    }

    /** Ground distance to the closest cell not in [known], searching out to about 2 km; null if none found. */
    fun closestUnknown(lat: Double, lng: Double, known: Set<Long>): Double? {
        var best: Double? = null
        var m = 100.0
        while (m <= 2000.0 && best == null) {
            for (k in cellsNear(lat, lng, m)) {
                if (known.contains(k)) continue
                val (la, lo) = latLngOf(k)
                val d = distance(lat, lng, la, lo)
                if (best == null || d < best) best = d
            }
            m += 150.0
        }
        return best
    }
}
