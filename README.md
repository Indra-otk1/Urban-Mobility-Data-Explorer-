# Urban Mobility Data Explorer

Full-stack dashboard for exploring NYC taxi mobility patterns using TLC trip
records, taxi zone lookup data, and taxi zone spatial metadata.

## Video Walkthrough

[Link to video walkthrough](YOUR_VIDEO_LINK_HERE)

---

## What's included

- Node.js / Express backend backed by MySQL.
- Data cleaning, feature engineering, and exclusion logging.
- Manual algorithm implementation (custom hash map + quicksort) for zone ranking.
- HTML/CSS/JS frontend dashboard with charts and a paginated trips table.

---

## Raw data

The raw TLC data files are not committed to the repository because they are
large and distributed separately by NYC TLC.

Download the official data here:

- NYC TLC Trip Record Data: https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page
- Taxi Zone Lookup Table: https://d37ci6vzurychx.cloudfront.net/misc/taxi_zone_lookup.csv
- Taxi Zone Shapefile archive: https://d37ci6vzurychx.cloudfront.net/misc/taxi_zones.zip

For this project you need these three inputs:

- `yellow_tripdata_*.csv` — the trip fact data (monthly CSV from the TLC page).
- `taxi_zone_lookup.csv` — the zone lookup dimension table.
- `taxi_zones.geojson` — the spatial zone metadata.

> **Note on the shapefile:** the TLC distributes zone boundaries as a Shapefile
> archive (.zip). Unzip it and convert to GeoJSON using the helper script
> already in the backend folder:
> ```bash
> python convert_shapefile.py
> ```
> This produces `data/taxi_zones.geojson` which the ingestion pipeline expects.

---

## Prerequisites

- Node.js 18+
- Python 3 with `pyshp` installed (`pip install pyshp`) — only needed for the
  shapefile conversion step above.
- MySQL 8.x (or 5.7+) running locally.

---

## Backend Setup

### 1. Install dependencies

Navigate to the backend folder and install:

```bash
cd backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your MySQL credentials and the paths to your data files:

```
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password_here
DB_NAME=urban_mobility
PORT=4000
TRIP_PARQUET_PATH=./data/yellow_tripdata_2019-01.csv
ZONE_LOOKUP_CSV_PATH=./data/taxi_zone_lookup.csv
ZONE_GEOJSON_PATH=./data/taxi_zones.geojson
INGEST_ROW_LIMIT=
```

> **Note:** use `DB_HOST=127.0.0.1` not `localhost` — on Windows, `localhost`
> can cause MySQL to look for a socket file instead of a TCP connection.

While developing, set `INGEST_ROW_LIMIT=50000` to ingest a small subset for
fast iteration. Leave it blank to ingest the full file.

### 3. Create the database schema

With MySQL running:

```bash
mysql -u root -p < db/schema.sql
```

> **Windows users:** if `mysql` is not recognised as a command, open
> **MySQL Command Line Client** from the Start menu, enter your password,
> then run:
> ```sql
> source C:/path/to/backend/db/schema.sql
> ```

### 4. Place the raw data files

Copy your downloaded files into the `data/` folder so the paths match `.env`:

```
backend/
└── data/
    ├── yellow_tripdata_2019-01.csv
    ├── taxi_zone_lookup.csv
    └── taxi_zones.geojson
```

### 5. Run the ingestion pipeline

```bash
npm run ingest
```

> **Windows users — if npm fails with an ENOENT error**, run the script
> directly with Node, bypassing npm:
> ```bash
> node --max-old-space-size=4096 scripts/ingest.js
> ```

This will:
1. Load `taxi_zone_lookup.csv` into the `zone` table (265 zones).
2. Load `taxi_zones.geojson` polygons into `zone_boundary`.
3. Stream the trip CSV, clean each row (see `scripts/clean.js`), and
   batch-insert valid rows into `trip`. Rejected rows are logged into
   `excluded_record_log` with a specific reason — nothing is silently dropped.

Progress is printed every 50,000 rows. A full month (~7.6 million rows) takes
several minutes — this is expected.

### 6. Start the API server

```bash
npm start
```

> **Windows users — if npm fails**, run directly:
> ```bash
> node src/server.js
> ```

The API will be available at `http://localhost:4000`.

For development with auto-restart on file changes:

```bash
npm run dev
```

---

## Frontend Setup

Open a second terminal, navigate to the frontend folder, and serve it:

```bash
cd frontend
npx serve .
```

Then open `http://localhost:3000` in your browser.

> **If npx is unavailable or fails on Windows**, simply double-click
> `index.html` in File Explorer to open it directly in your browser.
> This works as long as the API URL in `app.js` points to a running backend.

> **Accessing from another machine on the same network:** change the first
> line of `frontend/app.js` from `http://localhost:4000/api` to
> `http://YOUR_IP_ADDRESS:4000/api`, where YOUR_IP_ADDRESS is the IPv4
> address of the machine running the backend (find it with `ipconfig`).
> You will also need to allow port 4000 through Windows Firewall.

---

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
- `GET /api/zones/:id/boundary` — GeoJSON polygon for that zone.

### Insights
- `GET /api/insights/top-zones?metric=trip_count|total_revenue|avg_distance&limit=10`
  — ranks zones using the custom hash map + quicksort in
  `src/algorithms/zoneAggregation.js` (no built-in grouping or sorting).
- `GET /api/insights/hourly-demand` — trip volume and average fare by hour of day.
- `GET /api/insights/borough-summary` — trip volume, revenue, and tipping by borough.

---

## Project structure

```
backend/
├── db/
│   └── schema.sql              -- MySQL schema (fact + dimension tables, indexes)
├── scripts/
│   ├── clean.js                -- data cleaning and feature engineering functions
│   └── ingest.js               -- pipeline: loads CSV + GeoJSON into MySQL
├── src/
│   ├── algorithms/
│   │   └── zoneAggregation.js  -- manual hash map + quicksort (DSA requirement)
│   ├── routes/
│   │   ├── trips.js
│   │   ├── zones.js
│   │   └── insights.js
│   ├── db.js                   -- MySQL connection pool
│   └── server.js               -- Express entry point
├── data/                       -- raw data files go here (gitignored)
├── convert_shapefile.py        -- converts taxi_zones shapefile to GeoJSON
├── .env.example
└── package.json

frontend/
├── index.html
├── style.css
└── app.js

docs/
└── report.pdf                  -- technical documentation report

db/
└── dump.sql                    -- exported database dump
```

---

## Re-running ingestion

`npm run ingest` (or `node --max-old-space-size=4096 scripts/ingest.js`)
truncates and reloads `zone`, `zone_boundary`, and `trip` each time it runs,
so it is safe to re-run after fixing a bug — you will not end up with
duplicate rows.

---

## Known limitations

- The borough filter in the frontend is applied client-side on the current
  page of results, not server-side across all 7.6 million rows.
- The top-zones insight uses a 100k-row sample so the dashboard stays
  responsive during a live demo; it is not a full-table aggregation.
- The dashboard is intended to run with a local backend at `localhost:4000`.
- The data pipeline is tuned for the NYC TLC yellow taxi CSV schema; other
  TLC vehicle types or formats would need mapping updates in `clean.js`.