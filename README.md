# Urban Mobility Data Explorer — Backend

Node.js / Express backend for the Urban Mobility Data Explorer, backed by MySQL.
Cleans and loads the NYC TLC yellow taxi dataset, then serves it through a
filterable, sortable REST API.

## Prerequisites

- Node.js 18+
- MySQL 8.x (or 5.7+) running locally or accessible remotely
- The three raw TLC data files, downloaded from the assignment page:
  - `yellow_tripdata_*.parquet`
  - `taxi_zone_lookup.csv`
  - `taxi_zones.geojson` (the spatial metadata)

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set your MySQL credentials (`DB_USER`, `DB_PASSWORD`, etc.)
and the paths to your three downloaded data files.

While developing, you can set `INGEST_ROW_LIMIT=50000` (or similar) in `.env`
to ingest only a subset of trips for fast iteration. Remove it (leave blank)
to ingest the full file.

## 3. Create the database schema

With MySQL running and your `.env` credentials valid:

```bash
mysql -u root -p < db/schema.sql
```

This creates the `urban_mobility` database and all tables (`zone`,
`zone_boundary`, `trip`, `excluded_record_log`).

## 4. Place the raw data files

Put the three downloaded files into the `data/` folder (or update the paths
in `.env` to point wherever you saved them):

```
data/
  yellow_tripdata.parquet
  taxi_zone_lookup.csv
  taxi_zones.geojson
```

## 5. Run the ingestion pipeline

```bash
npm run ingest
```

This will:
1. Load `taxi_zone_lookup.csv` into the `zone` table
2. Load `taxi_zones.geojson` polygons into `zone_boundary`
3. Stream the trip parquet file, clean each row (see `scripts/clean.js`),
   and batch-insert valid rows into `trip`. Rows that fail validation are
   logged into `excluded_record_log` with a reason, not silently dropped.

Progress is logged to the console every 50,000 rows. For a full month of
data (a few million rows) this can take several minutes — that's expected.

**Note on parquet reading:** this pipeline uses `parquetjs-lite` to read the
`.parquet` file directly in Node. If your downloaded file uses a Parquet
feature/encoding this library doesn't support, `npm run ingest` will throw
an error when opening the file. If that happens, convert the file to CSV
first (e.g. `pandas.read_parquet(...).to_csv(...)` in a one-off Python
script) and point `TRIP_PARQUET_PATH` workflow to a CSV-reading variant
instead — ask your team to adapt `loadTrips()` in `scripts/ingest.js` to use
`csv-parser` the same way `loadZones()` already does.

## 6. Start the API server

```bash
npm start
```

The API will be available at `http://localhost:4000` (or whatever `PORT`
you set in `.env`).

For development with auto-restart on file changes:

```bash
npm run dev
```

## API Reference

### Health check
`GET /api/health`

### Trips
- `GET /api/trips` — paginated, filterable, sortable list of trips.
  Query params: `start_date`, `end_date` (YYYY-MM-DD), `pickup_zone`,
  `dropoff_zone`, `min_distance`, `max_distance`, `min_fare`, `max_fare`,
  `payment_type`, `rate_code_id`, `is_airport_trip` (0/1), `sort_by`
  (`pickup_datetime` | `fare` | `distance` | `duration` | `tip_percentage`),
  `order` (`asc`/`desc`), `page`, `page_size` (max 200).
- `GET /api/trips/:id` — single trip detail with joined zone names.

### Zones
- `GET /api/zones` — list all taxi zones (for filter dropdowns).
- `GET /api/zones/:id` — single zone detail.
- `GET /api/zones/:id/boundary` — GeoJSON polygon for that zone (for map rendering).

### Insights
- `GET /api/insights/top-zones?metric=trip_count|total_revenue|avg_distance&limit=10`
  — ranks zones using the **custom hash map + quicksort** implementation in
  `src/algorithms/zoneAggregation.js` (no built-in grouping/sorting functions).
- `GET /api/insights/hourly-demand` — trip volume and average fare by hour of day.
- `GET /api/insights/borough-summary` — trip volume, revenue, and tipping by borough.

## Project structure

```
db/
  schema.sql              -- MySQL schema (fact + dimension tables, indexes)
scripts/
  clean.js                -- pure data-cleaning / feature-engineering functions
  ingest.js               -- pipeline: loads CSV + GeoJSON + parquet into MySQL
src/
  algorithms/
    zoneAggregation.js     -- manual hash map + quicksort (DSA requirement)
  routes/
    trips.js
    zones.js
    insights.js
  db.js                    -- MySQL connection pool
  server.js                 -- Express app entry point
data/                        -- put your downloaded raw files here (gitignored)
.env.example
package.json
```

## Re-running ingestion

`npm run ingest` truncates and reloads `zone`, `zone_boundary`, and `trip`
each time it runs, so it's safe to re-run after fixing a bug in
`clean.js` — you won't end up with duplicate rows.
