// src/routes/zones.js
//
// GET /api/zones            -> list all zones (for filter dropdowns)
// GET /api/zones/:id        -> single zone detail
// GET /api/zones/:id/boundary -> GeoJSON geometry for map rendering

const express = require('express');
const router = express.Router();
const pool = require('../db');

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT location_id, borough, zone_name, service_zone FROM zone ORDER BY borough, zone_name'
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid zone id' });

    const [rows] = await pool.query(
      'SELECT location_id, borough, zone_name, service_zone FROM zone WHERE location_id = ?',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Zone not found' });

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/boundary', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid zone id' });

    const [rows] = await pool.query(
      'SELECT location_id, geometry FROM zone_boundary WHERE location_id = ?',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Boundary not found for this zone' });

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
