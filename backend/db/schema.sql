-- Urban Mobility Data Explorer - Database Schema (MySQL 8+)
 
CREATE DATABASE IF NOT EXISTS taxi_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
 
USE taxi_db;
 
-- Dimension: Vendor
CREATE TABLE dim_vendor (
    vendor_id   TINYINT PRIMARY KEY,
    vendor_name VARCHAR(50) NOT NULL
);
 
INSERT INTO dim_vendor (vendor_id, vendor_name) VALUES
    (1, 'Creative Mobile Technologies'),
    (2, 'Curb Mobility / VeriFone');
 
-- Dimension: Rate Code
CREATE TABLE dim_rate_code (
    rate_code_id TINYINT PRIMARY KEY,
    description  VARCHAR(50) NOT NULL
);
 
INSERT INTO dim_rate_code (rate_code_id, description) VALUES
    (1, 'Standard rate'),
    (2, 'JFK'),
    (3, 'Newark'),
    (4, 'Nassau or Westchester'),
    (5, 'Negotiated fare'),
    (6, 'Group ride'),
    (99, 'Unknown / Null');
 
-- Dimension: Payment Type
CREATE TABLE dim_payment_type (
    payment_type_id TINYINT PRIMARY KEY,
    description      VARCHAR(30) NOT NULL
);
 
INSERT INTO dim_payment_type (payment_type_id, description) VALUES
    (0, 'Flex Fare trip'),
    (1, 'Credit card'),
    (2, 'Cash'),
    (3, 'No charge'),
    (4, 'Dispute'),
    (5, 'Unknown'),
    (6, 'Voided trip');
 
-- Dimension: Zone (with spatial geometry)
CREATE TABLE dim_zone (
    location_id   SMALLINT PRIMARY KEY,
    borough       VARCHAR(30)  NOT NULL,
    zone          VARCHAR(100) NOT NULL,
    service_zone  VARCHAR(30),
    geom          GEOMETRY NOT NULL SRID 4326,
    centroid_lat  DECIMAL(9,6),
    centroid_lng  DECIMAL(9,6),
    SPATIAL INDEX idx_zone_geom (geom)
);

-- Fact: Trip
CREATE TABLE fact_trip (
    trip_id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    vendor_id             TINYINT,
    pickup_datetime       DATETIME NOT NULL,
    dropoff_datetime      DATETIME NOT NULL,
    passenger_count       TINYINT,
    trip_distance         DECIMAL(8,2),
    rate_code_id          TINYINT,
    pu_location_id        SMALLINT,
    do_location_id        SMALLINT,
    payment_type_id       TINYINT,
    fare_amount           DECIMAL(8,2),
    extra                 DECIMAL(6,2),
    mta_tax               DECIMAL(6,2),
    tip_amount            DECIMAL(8,2),
    tolls_amount          DECIMAL(8,2),
    improvement_surcharge DECIMAL(6,2),
    total_amount          DECIMAL(8,2),
    congestion_surcharge  DECIMAL(6,2),
    airport_fee           DECIMAL(6,2),
 
    -- Derived / engineered features
    trip_duration_min     DECIMAL(8,2),
    avg_speed_mph         DECIMAL(6,2),
    tip_percentage        DECIMAL(7,2),
    is_airport_trip       BOOLEAN,
 
    CONSTRAINT fk_trip_vendor   FOREIGN KEY (vendor_id)       REFERENCES dim_vendor(vendor_id),
    CONSTRAINT fk_trip_rate     FOREIGN KEY (rate_code_id)    REFERENCES dim_rate_code(rate_code_id),
    CONSTRAINT fk_trip_payment  FOREIGN KEY (payment_type_id) REFERENCES dim_payment_type(payment_type_id),
    CONSTRAINT fk_trip_pu_zone  FOREIGN KEY (pu_location_id)  REFERENCES dim_zone(location_id),
    CONSTRAINT fk_trip_do_zone  FOREIGN KEY (do_location_id)  REFERENCES dim_zone(location_id)
);
 
-- Indexes for common query patterns
CREATE INDEX idx_trip_pickup_time ON fact_trip (pickup_datetime);
CREATE INDEX idx_trip_pu_zone     ON fact_trip (pu_location_id);
CREATE INDEX idx_trip_do_zone     ON fact_trip (do_location_id);
CREATE INDEX idx_trip_payment     ON fact_trip (payment_type_id);
 