// src/routes/insights.js
//
// GET /api/insights/top-zones?metric=trip_count|total_revenue|avg_distance&limit=10
//   Pulls trip rows from MySQL, then runs them through the MANUAL
//   hash-map + quicksort implementation (src/algorithms/zoneAggregation.js)
//   rather than doing GROUP BY / ORDER BY in SQL. This is intentional —
//   it's what satisfies the "custom algorithm, no built-in sort/grouping"
//   requirement in the assignment. Every other endpoint in this API
//   DOES use normal SQL aggregation, which is the correct real-world
//   choice; this endpoint exists specifically to demonstrate the
//   manual implementation against real data.
//
// GET /api/insights/hourly-demand     -> trips grouped by hour of day (SQL aggregation; for charts)
// GET /api/insights/borough-summary   -> trips grouped by pickup borough (SQL aggregation; for charts)

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { aggregateTripsByZone, rankZoneAggregates } = require('../algorithms/zoneAggregation');

const VALID_METRICS = new Set(['trip_count', 'total_revenue', 'avg_distance']);

router.get('/top-zones', async (req, res, next) => {
  try {
    const metric = VALID_METRICS.has(req.query.metric) ? req.query.metric : 'trip_count';
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));

    // Pull only the columns the algorithm actually needs. For a full
    // month of data this is still a few million rows — fine for a
    // single in-memory pass, but worth noting in your report as a
    // scalability consideration (a production system would maintain
    // a pre-aggregated rollup table instead of recomputing on every
    // request).
    const [trips] = await pool.query(
      `SELECT pickup_location_id, total_amount, trip_distance_mi, tip_percentage FROM trip`
    );

    const aggregates = aggregateTripsByZone(trips);
    const ranked = rankZoneAggregates(aggregates, metric, true).slice(0, limit);

    // Enrich with zone names for display (small lookup, fine as SQL)
    const zoneIds = ranked.map((r) => r.zoneId);
    let zoneNames = {};
    if (zoneIds.length > 0) {
      const [zoneRows] = await pool.query(
        `SELECT location_id, zone_name, borough FROM zone WHERE location_id IN (?)`,
        [zoneIds]
      );
      zoneNames = Object.fromEntries(zoneRows.map((z) => [z.location_id, z]));
    }

    res.json({
      metric,
      data: ranked.map((r) => ({
        ...r,
        zoneName: zoneNames[r.zoneId]?.zone_name || 'Unknown',
        borough: zoneNames[r.zoneId]?.borough || 'Unknown',
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/hourly-demand', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT HOUR(pickup_datetime) AS hour_of_day,
             COUNT(*) AS trip_count,
             ROUND(AVG(total_amount), 2) AS avg_fare,
             ROUND(AVG(trip_duration_min), 2) AS avg_duration_min
      FROM trip
      GROUP BY HOUR(pickup_datetime)
      ORDER BY hour_of_day
    `);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/borough-summary', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT z.borough,
             COUNT(*) AS trip_count,
             ROUND(SUM(t.total_amount), 2) AS total_revenue,
             ROUND(AVG(t.trip_distance_mi), 2) AS avg_distance,
             ROUND(AVG(t.tip_percentage), 2) AS avg_tip_percentage
      FROM trip t
      JOIN zone z ON z.location_id = t.pickup_location_id
      GROUP BY z.borough
      ORDER BY trip_count DESC
    `);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
