// src/routes/trips.js
//
// GET /api/trips
//   Query params (all optional):
//     start_date, end_date       -> filter by pickup_datetime range (YYYY-MM-DD)
//     pickup_zone, dropoff_zone  -> filter by location_id
//     min_distance, max_distance -> filter by trip_distance_mi
//     min_fare, max_fare         -> filter by total_amount
//     payment_type, rate_code_id -> filter by exact match
//     is_airport_trip            -> 0 or 1
//     sort_by                    -> one of an allowlist (see below)
//     order                      -> 'asc' | 'desc'
//     page, page_size            -> pagination (page_size capped at 200)
//
// GET /api/trips/:id  -> single trip detail, with joined zone names

const express = require('express');
const router = express.Router();
const pool = require('../db');

// Allowlist of sortable columns. Never interpolate a raw query param
// directly into ORDER BY — that's a SQL injection vector even with
// parameterized queries (placeholders can't be used for identifiers).
const SORTABLE_COLUMNS = {
  pickup_datetime: 'pickup_datetime',
  fare: 'total_amount',
  distance: 'trip_distance_mi',
  duration: 'trip_duration_min',
  tip_percentage: 'tip_percentage',
};

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

router.get('/', async (req, res, next) => {
  try {
    const {
      start_date, end_date,
      pickup_zone, dropoff_zone,
      min_distance, max_distance,
      min_fare, max_fare,
      payment_type, rate_code_id,
      is_airport_trip,
      sort_by = 'pickup_datetime',
      order = 'desc',
      page = '1',
      page_size = String(DEFAULT_PAGE_SIZE),
    } = req.query;

    const where = [];
    const params = [];

    if (start_date) { where.push('pickup_datetime >= ?'); params.push(`${start_date} 00:00:00`); }
    if (end_date)   { where.push('pickup_datetime <= ?'); params.push(`${end_date} 23:59:59`); }
    if (pickup_zone)  { where.push('pickup_location_id = ?'); params.push(Number(pickup_zone)); }
    if (dropoff_zone) { where.push('dropoff_location_id = ?'); params.push(Number(dropoff_zone)); }
    if (min_distance) { where.push('trip_distance_mi >= ?'); params.push(Number(min_distance)); }
    if (max_distance) { where.push('trip_distance_mi <= ?'); params.push(Number(max_distance)); }
    if (min_fare) { where.push('total_amount >= ?'); params.push(Number(min_fare)); }
    if (max_fare) { where.push('total_amount <= ?'); params.push(Number(max_fare)); }
    if (payment_type) { where.push('payment_type = ?'); params.push(Number(payment_type)); }
    if (rate_code_id) { where.push('rate_code_id = ?'); params.push(Number(rate_code_id)); }
    if (is_airport_trip !== undefined) { where.push('is_airport_trip = ?'); params.push(Number(is_airport_trip)); }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const sortColumn = SORTABLE_COLUMNS[sort_by] || SORTABLE_COLUMNS.pickup_datetime;
    const sortOrder = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSizeNum = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(page_size, 10) || DEFAULT_PAGE_SIZE));
    const offset = (pageNum - 1) * pageSizeNum;

    const [rows] = await pool.query(
      `SELECT trip_id, pickup_datetime, dropoff_datetime, pickup_location_id,
              dropoff_location_id, passenger_count, trip_distance_mi,
              rate_code_id, payment_type, total_amount, trip_duration_min,
              avg_speed_mph, tip_percentage, is_airport_trip
       FROM trip
       ${whereClause}
       ORDER BY ${sortColumn} ${sortOrder}
       LIMIT ? OFFSET ?`,
      [...params, pageSizeNum, offset]
    );

    // Separate count query for total — needed so the frontend can
    // render pagination controls without pulling every matching row.
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM trip ${whereClause}`,
      params
    );

    res.json({
      data: rows,
      pagination: {
        page: pageNum,
        page_size: pageSizeNum,
        total: countRows[0].total,
        total_pages: Math.ceil(countRows[0].total / pageSizeNum),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const tripId = Number(req.params.id);
    if (isNaN(tripId)) {
      return res.status(400).json({ error: 'Invalid trip id' });
    }

    const [rows] = await pool.query(
      `SELECT t.*, 
              pu.zone_name AS pickup_zone_name, pu.borough AS pickup_borough,
              do.zone_name AS dropoff_zone_name, do.borough AS dropoff_borough
       FROM trip t
       JOIN zone pu ON pu.location_id = t.pickup_location_id
       JOIN zone do ON do.location_id = t.dropoff_location_id
       WHERE t.trip_id = ?`,
      [tripId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
