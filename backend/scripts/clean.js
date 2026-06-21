// scripts/clean.js
//
// Pure functions for cleaning a single raw trip record and computing
// derived features. Kept separate from ingest.js (which handles file
// I/O and database writes) so this logic is easy to read, test, and
// describe in the documentation report.
//
// Each function returns either:
//   { ok: true, trip: {...cleaned fields...} }
//   { ok: false, reason: "human readable reason" }
// so the caller (ingest.js) can log exclusions without losing the
// reason why a row was dropped.

// Airport zone IDs in the standard NYC TLC taxi_zone_lookup.csv.
// (132 = JFK Airport, 138 = LaGuardia Airport, 1 = Newark Airport)
const AIRPORT_ZONE_IDS = new Set([1, 132, 138]);

// Reasonable physical/business bounds used to catch outliers.
// These thresholds are deliberately generous — the goal is to catch
// data-entry errors and sensor glitches, not to aggressively trim
// legitimate long trips. Document your chosen thresholds in the report.
const BOUNDS = {
  MIN_FARE: 0,           // negative fares are meter/refund errors
  MAX_FARE: 1000,         // beyond this is almost certainly a data error
  MIN_DISTANCE: 0,
  MAX_DISTANCE: 200,      // miles; NYC-area trips essentially never exceed this
  MIN_DURATION_MIN: 0.5,  // trips under 30 seconds are likely cancellations/glitches
  MAX_DURATION_MIN: 24 * 60, // a trip "lasting" more than a day is a timestamp error
  MAX_PASSENGERS: 9,      // TLC vehicles are not licensed beyond this
};

/**
 * Clean and enrich one raw trip row.
 * `raw` is expected to have (at minimum) the standard TLC yellow trip
 * columns: tpep_pickup_datetime, tpep_dropoff_datetime, PULocationID,
 * DOLocationID, passenger_count, trip_distance, RatecodeID,
 * payment_type, fare_amount, extra, mta_tax, tip_amount, tolls_amount,
 * improvement_surcharge, congestion_surcharge, total_amount.
 */
function cleanTrip(raw, validZoneIds) {
  // --- 1. Required fields present at all ---
  if (!raw.tpep_pickup_datetime || !raw.tpep_dropoff_datetime) {
    return { ok: false, reason: 'missing pickup or dropoff timestamp' };
  }
  if (raw.PULocationID == null || raw.DOLocationID == null) {
    return { ok: false, reason: 'missing pickup or dropoff location id' };
  }

  const pickupTime = new Date(raw.tpep_pickup_datetime);
  const dropoffTime = new Date(raw.tpep_dropoff_datetime);

  if (isNaN(pickupTime.getTime()) || isNaN(dropoffTime.getTime())) {
    return { ok: false, reason: 'unparseable timestamp' };
  }
  const pickupYear = pickupTime.getFullYear();

  if (pickupYear < 2009 || pickupYear > 2024) {
  return { ok: false, reason: `pickup year out of expected range (${pickupYear})` };
}

  // --- 2. Logical/temporal integrity ---
  const durationMin = (dropoffTime.getTime() - pickupTime.getTime()) / 1000 / 60;

  if (durationMin <= 0) {
    return { ok: false, reason: 'dropoff time is before or equal to pickup time' };
  }
  if (durationMin < BOUNDS.MIN_DURATION_MIN) {
    return { ok: false, reason: `trip duration below ${BOUNDS.MIN_DURATION_MIN} min (likely cancelled fare)` };
  }
  if (durationMin > BOUNDS.MAX_DURATION_MIN) {
    return { ok: false, reason: `trip duration exceeds ${BOUNDS.MAX_DURATION_MIN} min (timestamp error)` };
  }

  // --- 3. Foreign key integrity: location IDs must exist in the zone dimension ---
  const puZone = Number(raw.PULocationID);
  const doZone = Number(raw.DOLocationID);
  if (!validZoneIds.has(puZone) || !validZoneIds.has(doZone)) {
    return { ok: false, reason: 'pickup or dropoff location id not found in zone lookup' };
  }

  // --- 4. Numeric field validation / outlier rejection ---
  const distance = Number(raw.trip_distance);
  if (isNaN(distance) || distance < BOUNDS.MIN_DISTANCE || distance > BOUNDS.MAX_DISTANCE) {
    return { ok: false, reason: `trip_distance out of plausible range (${raw.trip_distance})` };
  }

  const fareAmount = Number(raw.fare_amount);
  const totalAmount = Number(raw.total_amount);
  if (isNaN(fareAmount) || fareAmount < BOUNDS.MIN_FARE || fareAmount > BOUNDS.MAX_FARE) {
    return { ok: false, reason: `fare_amount out of plausible range (${raw.fare_amount})` };
  }
  if (isNaN(totalAmount) || totalAmount < 0) {
    return { ok: false, reason: `negative total_amount (${raw.total_amount})` };
  }

  let passengerCount = Number(raw.passenger_count);
  if (isNaN(passengerCount) || passengerCount < 0) {
    // Missing/invalid passenger count is common in the raw data and not
    // fatal to the record's usefulness — default to null rather than
    // discarding the whole trip.
    passengerCount = null;
  } else if (passengerCount > BOUNDS.MAX_PASSENGERS) {
    return { ok: false, reason: `passenger_count implausibly high (${raw.passenger_count})` };
  } else if (passengerCount === 0) {
    // 0-passenger trips appear in the raw TLC data (often sensor/log
    // artifacts). Treat as missing rather than excluding the trip.
    passengerCount = null;
  }

  // --- 5. Normalize categorical fields ---
  let rateCodeId = Number(raw.RatecodeID);
  if (isNaN(rateCodeId) || rateCodeId < 1 || rateCodeId > 6) rateCodeId = null;

  let paymentType = Number(raw.payment_type);
  if (isNaN(paymentType) || paymentType < 1 || paymentType > 6) paymentType = null;

  // --- 6. Feature engineering (derived features #1, #2, #3) ---

  // Feature 1: average speed (mph). Tells us about congestion / route
  // efficiency in a way raw distance or duration alone don't.
  const avgSpeedMph = durationMin > 0
    ? round2(distance / (durationMin / 60))
    : null;

  // Sanity-check the derived speed too — an implausible avg speed
  // usually means the distance or duration was wrong even if each
  // individually passed its own bounds check above.
  if (avgSpeedMph !== null && (avgSpeedMph < 0 || avgSpeedMph > 100)) {
    return { ok: false, reason: `derived avg_speed_mph implausible (${avgSpeedMph})` };
  }

  // Feature 2: tip percentage. Tells us about payment/tipping behavior,
  // independent of trip size — only meaningful for card payments in
  // the TLC data (cash tips aren't reliably recorded), but we compute
  // it whenever fare_amount > 0 and let the frontend decide how to
  // slice by payment_type.
  // Feature 2: tip percentage
const tipPercentage = fareAmount > 0
  ? Math.min(9999.99, round2((Number(raw.tip_amount) || 0) / fareAmount * 100))
  : null;

  // Feature 3: is_airport_trip. Tells us about airport-related travel
  // demand, a distinct economic/behavioral segment from ordinary
  // intra-city trips (different pricing rules, different time-of-day
  // patterns).
  const isAirportTrip = (AIRPORT_ZONE_IDS.has(puZone) || AIRPORT_ZONE_IDS.has(doZone)) ? 1 : 0;

  return {
    ok: true,
    trip: {
      pickup_datetime: toMysqlDatetime(pickupTime),
      dropoff_datetime: toMysqlDatetime(dropoffTime),
      pickup_location_id: puZone,
      dropoff_location_id: doZone,
      passenger_count: passengerCount,
      trip_distance_mi: round2(distance),
      rate_code_id: rateCodeId,
      payment_type: paymentType,
      fare_amount: round2(fareAmount),
      extra: round2(Number(raw.extra) || 0),
      mta_tax: round2(Number(raw.mta_tax) || 0),
      tip_amount: round2(Number(raw.tip_amount) || 0),
      tolls_amount: round2(Number(raw.tolls_amount) || 0),
      improvement_surcharge: round2(Number(raw.improvement_surcharge) || 0),
      congestion_surcharge: round2(Number(raw.congestion_surcharge) || 0),
      total_amount: round2(totalAmount),
      trip_duration_min: round2(durationMin),
      avg_speed_mph: avgSpeedMph,
      tip_percentage: tipPercentage,
      is_airport_trip: isAirportTrip,
    },
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function toMysqlDatetime(date) {
  // YYYY-MM-DD HH:MM:SS, what MySQL's DATETIME column expects.
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = { cleanTrip, BOUNDS, AIRPORT_ZONE_IDS };
