// scripts/ingest.js
//
// One-time (or re-runnable) data pipeline:
//   1. Load taxi_zone_lookup.csv -> `zone` table
//   2. Load taxi_zones.geojson   -> `zone_boundary` table
//   3. Stream yellow_tripdata.parquet, clean each row via clean.js,
//      batch-insert good rows into `trip`, log excluded rows into
//      `excluded_record_log`.
//
// Run with: npm run ingest
// Respects INGEST_ROW_LIMIT from .env for fast dev iteration.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const parquet = require('parquetjs-lite');
const pool = require('../src/db');
const { cleanTrip } = require('./clean');

const TRIP_PARQUET_PATH = process.env.TRIP_PARQUET_PATH || './data/yellow_tripdata.parquet';
const ZONE_LOOKUP_CSV_PATH = process.env.ZONE_LOOKUP_CSV_PATH || './data/taxi_zone_lookup.csv';
const ZONE_GEOJSON_PATH = process.env.ZONE_GEOJSON_PATH || './data/taxi_zones.geojson';
const ROW_LIMIT = process.env.INGEST_ROW_LIMIT ? Number(process.env.INGEST_ROW_LIMIT) : null;

const TRIP_BATCH_SIZE = 1000;
const EXCLUSION_BATCH_SIZE = 500;

async function loadZones() {
  console.log('--- Loading zone lookup CSV ---');
  const rows = await new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(path.resolve(ZONE_LOOKUP_CSV_PATH))
      .pipe(csv())
      .on('data', (row) => results.push(row))
      .on('end', () => resolve(results))
      .on('error', reject);
  });

  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query('TRUNCATE TABLE zone_boundary');
    await conn.query('TRUNCATE TABLE trip');
    await conn.query('TRUNCATE TABLE zone');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    const values = rows
      .filter((r) => r.LocationID)
      .map((r) => [
        Number(r.LocationID),
        r.Borough || 'Unknown',
        r.Zone || 'Unknown',
        r.service_zone || null,
      ]);

    if (values.length > 0) {
      await conn.query(
        'INSERT INTO zone (location_id, borough, zone_name, service_zone) VALUES ?',
        [values]
      );
    }
    console.log(`Loaded ${values.length} zones.`);
  } finally {
    conn.release();
  }

  return new Set(rows.map((r) => Number(r.LocationID)).filter((n) => !isNaN(n)));
}

async function loadZoneBoundaries(validZoneIds) {
  console.log('--- Loading zone GeoJSON boundaries ---');
  const raw = fs.readFileSync(path.resolve(ZONE_GEOJSON_PATH), 'utf8');
  const geojson = JSON.parse(raw);

  const features = geojson.features || [];
  const values = [];

  for (const feature of features) {
    // The standard NYC taxi_zones GeoJSON keys the zone id as
    // `LocationID` inside feature.properties — adjust here if your
    // downloaded file uses a different property name.
    const props = feature.properties || {};
    const locationId = Number(props.LocationID ?? props.location_id);
    if (!locationId || !validZoneIds.has(locationId)) continue;

    values.push([locationId, JSON.stringify(feature.geometry)]);
  }

  if (values.length > 0) {
    const conn = await pool.getConnection();
    try {
      await conn.query(
        'INSERT INTO zone_boundary (location_id, geometry) VALUES ? ON DUPLICATE KEY UPDATE geometry = VALUES(geometry)',
        [values]
      );
    } finally {
      conn.release();
    }
  }
  console.log(`Loaded ${values.length} zone boundaries.`);
}

async function flushTripBatch(batch) {
  if (batch.length === 0) return;
  const columns = [
    'pickup_datetime', 'dropoff_datetime', 'pickup_location_id', 'dropoff_location_id',
    'passenger_count', 'trip_distance_mi', 'rate_code_id', 'payment_type',
    'fare_amount', 'extra', 'mta_tax', 'tip_amount', 'tolls_amount',
    'improvement_surcharge', 'congestion_surcharge', 'total_amount',
    'trip_duration_min', 'avg_speed_mph', 'tip_percentage', 'is_airport_trip',
  ];
  const values = batch.map((t) => columns.map((c) => t[c]));

  const conn = await pool.getConnection();
  try {
    await conn.query(
      `INSERT INTO trip (${columns.join(', ')}) VALUES ?`,
      [values]
    );
  } finally {
    conn.release();
  }
}

async function flushExclusionBatch(batch) {
  if (batch.length === 0) return;
  const values = batch.map((e) => [e.source_row_ref, e.reason, JSON.stringify(e.raw_data)]);
  const conn = await pool.getConnection();
  try {
    await conn.query(
      'INSERT INTO excluded_record_log (source_row_ref, reason, raw_data) VALUES ?',
      [values]
    );
  } finally {
    conn.release();
  }
}

async function loadTrips(validZoneIds) {
  console.log('--- Streaming and cleaning trip CSV data ---');

  let rowIndex = 0;
  let acceptedCount = 0;
  let rejectedCount = 0;
  let tripBatch = [];
  let exclusionBatch = [];

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(path.resolve(TRIP_PARQUET_PATH))
      .pipe(csv());

    stream.on('data', async (record) => {
      if (ROW_LIMIT && rowIndex >= ROW_LIMIT) return;

      const result = cleanTrip(record, validZoneIds);
      if (result.ok) {
        tripBatch.push(result.trip);
        acceptedCount++;
      } else {
        exclusionBatch.push({
          source_row_ref: `row_${rowIndex}`,
          reason: result.reason,
          raw_data: record,
        });
        rejectedCount++;
      }

      rowIndex++;

      if (rowIndex % 50000 === 0) {
        console.log(`Processed ${rowIndex} rows... (accepted ${acceptedCount}, rejected ${rejectedCount})`);
      }

      // Pause the stream and flush to DB every 1000 rows so batches
      // never accumulate in memory beyond this size
      if (tripBatch.length >= TRIP_BATCH_SIZE || exclusionBatch.length >= EXCLUSION_BATCH_SIZE) {
        stream.pause();
        try {
          await flushTripBatch(tripBatch);
          await flushExclusionBatch(exclusionBatch);
          tripBatch = [];
          exclusionBatch = [];
        } catch (err) {
          reject(err);
        }
        stream.resume();
      }
    });

    stream.on('end', async () => {
      try {
        await flushTripBatch(tripBatch);
        await flushExclusionBatch(exclusionBatch);
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    stream.on('error', reject);
  });

  console.log(`--- Done. Total rows: ${rowIndex}, accepted: ${acceptedCount}, rejected: ${rejectedCount} ---`);
}

async function main() {
  try {
    const validZoneIds = await loadZones();
    await loadZoneBoundaries(validZoneIds);
    await loadTrips(validZoneIds);
    console.log('Ingestion complete.');
  } catch (err) {
    console.error('Ingestion failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
