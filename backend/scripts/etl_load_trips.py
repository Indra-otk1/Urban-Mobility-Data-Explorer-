"""
etl_load_trips.py
Cleans yellow_tripdata parquet file and bulk-inserts into fact_trip (MySQL).
 
Usage:
    py etl_load_trips.py
 
Requirements:
    py -m pip install pandas pyarrow mysql-connector-python tqdm
"""
 
import pandas as pd
import pyarrow.parquet as pq
import mysql.connector
from tqdm import tqdm
import csv
from dotenv import load_dotenv
import os
load_dotenv()  # Load DB_PASSWORD from .env file

#CONFIG 
PARQUET_FILE = "yellow_tripdata_2019-01.parquet"
LOOKUP_CSV   = "taxi_zone_lookup.csv"
EXCLUDED_LOG = "excluded_records.csv"
CHUNK_SIZE   = 50_000   # rows per DB insert batch
 
DB_CONFIG = {
    "host":     "localhost",
    "user":     "root",
    "password": os.getenv("DB_PASSWORD"),
    "database": "taxi_db",
}
 
#VALID REFERENCE IDs
VALID_VENDOR_IDS  = {1, 2}
VALID_RATE_CODES  = {1, 2, 3, 4, 5, 6, 99}
VALID_PAYMENT_IDS = {0, 1, 2, 3, 4, 5, 6}
AIRPORT_ZONE_IDS  = {1, 132, 138}   # EWR=1, JFK=132, LGA=138
 
# Load valid zone IDs that actually have geometry in dim_zone
NO_GEOM_ZONES = {57, 104, 105, 264, 265}
valid_zone_ids = set()
with open(LOOKUP_CSV, newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        lid = int(row["LocationID"])
        if lid not in NO_GEOM_ZONES:
            valid_zone_ids.add(lid)
 
#CLEANING FUNCTION
def clean_chunk(df: pd.DataFrame):
    original_len = len(df)
    excluded_rows = []
 
    #1. Rename columns to match schema
    df = df.rename(columns={
        "VendorID":             "vendor_id",
        "tpep_pickup_datetime": "pickup_datetime",
        "tpep_dropoff_datetime":"dropoff_datetime",
        "passenger_count":      "passenger_count",
        "trip_distance":        "trip_distance",
        "RatecodeID":           "rate_code_id",
        "PULocationID":         "pu_location_id",
        "DOLocationID":         "do_location_id",
        "payment_type":         "payment_type_id",
    })
 
    # Drop columns not in schema
    df = df.drop(columns=["store_and_fwd_flag"], errors="ignore")
 
    #2. airport_fee: all NULL in 2019 data → fill with 0 
    df["airport_fee"] = df.get("airport_fee", 0).fillna(0)
    df["congestion_surcharge"] = df["congestion_surcharge"].fillna(0)
 
    #3. Fill NULLs for nullable fields
    df["passenger_count"] = df["passenger_count"].fillna(0).astype(int)
    df["rate_code_id"]    = df["rate_code_id"].fillna(99).astype(int)
 
    #4. Temporal filters: keep only 2019 trips
    mask_time = (
        (df["pickup_datetime"].dt.year == 2019) &
        (df["dropoff_datetime"].dt.year == 2019) &
        (df["dropoff_datetime"] > df["pickup_datetime"])
    )
    excluded_rows.append(df[~mask_time].assign(reason="invalid_timestamp"))
    df = df[mask_time]
 
    #5. Physical distance filter (0 < distance ≤ 100 miles)
    mask_dist = (df["trip_distance"] > 0) & (df["trip_distance"] <= 100)
    excluded_rows.append(df[~mask_dist].assign(reason="invalid_distance"))
    df = df[mask_dist]
 
    #6. Fare amount filter (positive, ≤ $1000)
    mask_fare = (df["fare_amount"] > 0) & (df["fare_amount"] <= 1000)
    excluded_rows.append(df[~mask_fare].assign(reason="invalid_fare"))
    df = df[mask_fare]
 
    #7. Passenger count (0 allowed = unknown, max 9)
    mask_pax = df["passenger_count"] <= 9
    excluded_rows.append(df[~mask_pax].assign(reason="invalid_passenger_count"))
    df = df[mask_pax]
 
    #8. FK integrity: valid vendor, rate code, payment, zone
    mask_vendor  = df["vendor_id"].isin(VALID_VENDOR_IDS)
    mask_rate    = df["rate_code_id"].isin(VALID_RATE_CODES)
    mask_payment = df["payment_type_id"].isin(VALID_PAYMENT_IDS)
    mask_pu      = df["pu_location_id"].isin(valid_zone_ids)
    mask_do      = df["do_location_id"].isin(valid_zone_ids)
    mask_fk      = mask_vendor & mask_rate & mask_payment & mask_pu & mask_do
 
    excluded_rows.append(df[~mask_fk].assign(reason="invalid_fk_reference"))
    df = df[mask_fk]
 
    #9. Derived / engineered features
    duration = (df["dropoff_datetime"] - df["pickup_datetime"]).dt.total_seconds() / 60
    df["trip_duration_min"] = duration.round(2)
 
    # avg_speed_mph: distance / (duration in hours); cap at 80mph
    hours = duration / 60
    speed = df["trip_distance"] / hours.replace(0, float("nan"))
    df["avg_speed_mph"] = speed.clip(upper=80).round(2)
 
    # tip_percentage: tip / fare * 100; 0 if fare is 0; cap at 999.99
    df["tip_percentage"] = (
        (df["tip_amount"] / df["fare_amount"].replace(0, float("nan"))) * 100
    ).fillna(0).clip(upper=999.99).round(2)
 
    # is_airport_trip: pickup OR dropoff is at EWR, JFK, or LGA
    df["is_airport_trip"] = (
        df["pu_location_id"].isin(AIRPORT_ZONE_IDS) |
        df["do_location_id"].isin(AIRPORT_ZONE_IDS)
    ).astype(bool)
 
    # Filter out trips with negative or zero duration after derivation
    mask_dur = df["trip_duration_min"] > 0
    excluded_rows.append(df[~mask_dur].assign(reason="zero_or_negative_duration"))
    df = df[mask_dur]
 
    #10. Collate excluded rows
    excluded = pd.concat(
        [r[["pickup_datetime","pu_location_id","do_location_id","fare_amount","reason"]]
         for r in excluded_rows if len(r) > 0],
        ignore_index=True
    )
 
    print(f"  Chunk: {original_len} rows → kept {len(df)} | excluded {len(excluded)}")
    return df, excluded
 
 
#INSERT FUNCTION
INSERT_SQL = """
INSERT INTO fact_trip (
    vendor_id, pickup_datetime, dropoff_datetime, passenger_count,
    trip_distance, rate_code_id, pu_location_id, do_location_id,
    payment_type_id, fare_amount, extra, mta_tax, tip_amount,
    tolls_amount, improvement_surcharge, total_amount,
    congestion_surcharge, airport_fee,
    trip_duration_min, avg_speed_mph, tip_percentage, is_airport_trip
) VALUES (
    %s, %s, %s, %s,
    %s, %s, %s, %s,
    %s, %s, %s, %s, %s,
    %s, %s, %s,
    %s, %s,
    %s, %s, %s, %s
)
"""
 
COLUMNS = [
    "vendor_id","pickup_datetime","dropoff_datetime","passenger_count",
    "trip_distance","rate_code_id","pu_location_id","do_location_id",
    "payment_type_id","fare_amount","extra","mta_tax","tip_amount",
    "tolls_amount","improvement_surcharge","total_amount",
    "congestion_surcharge","airport_fee",
    "trip_duration_min","avg_speed_mph","tip_percentage","is_airport_trip"
]
 
 
def load_to_db(df: pd.DataFrame, cursor):
    # Replace NaN with None for MySQL
    df = df.where(pd.notnull(df), None)
    rows = [tuple(row) for row in df[COLUMNS].itertuples(index=False, name=None)]
    cursor.executemany(INSERT_SQL, rows)
 
 
#MAIN 
def main():
    print("Connecting to MySQL...")
    conn = mysql.connector.connect(**DB_CONFIG, autocommit=True)
    cursor = conn.cursor()
    print("Connected.\n")
 
    print(f"Reading {PARQUET_FILE} in chunks of {CHUNK_SIZE:,}...")
    table = pq.read_table(PARQUET_FILE)
    df_full = table.to_pandas()
    total_rows = len(df_full)
    print(f"Total rows in file: {total_rows:,}\n")
 
    all_excluded = []
    total_inserted = 0
 
    chunks = [df_full.iloc[i:i+CHUNK_SIZE] for i in range(0, total_rows, CHUNK_SIZE)]
 
    for i, chunk in enumerate(tqdm(chunks, desc="Loading chunks")):
        cleaned, excluded = clean_chunk(chunk.copy())
        all_excluded.append(excluded)
 
        if len(cleaned) > 0:
            load_to_db(cleaned, cursor)
            total_inserted += len(cleaned)
 
    # Write excluded log
    if all_excluded:
        excl_df = pd.concat(all_excluded, ignore_index=True)
        excl_df.to_csv(EXCLUDED_LOG, index=False)
        print(f"\nExcluded {len(excl_df):,} rows → saved to {EXCLUDED_LOG}")
 
    print(f"\n✅ Done! Inserted {total_inserted:,} trips into fact_trip.")
    cursor.close()
    conn.close()
 
 
if __name__ == "__main__":
    main()