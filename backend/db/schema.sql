-- Urban Mobility Data Explorer - Runtime schema used by backend/src and backend/scripts

CREATE DATABASE IF NOT EXISTS urban_mobility
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE urban_mobility;

DROP TABLE IF EXISTS excluded_record_log;
DROP TABLE IF EXISTS trip;
DROP TABLE IF EXISTS zone_boundary;
DROP TABLE IF EXISTS zone;

CREATE TABLE zone (
    location_id SMALLINT PRIMARY KEY,
    borough VARCHAR(30) NOT NULL,
    zone_name VARCHAR(100) NOT NULL,
    service_zone VARCHAR(30)
);

CREATE TABLE zone_boundary (
    location_id SMALLINT PRIMARY KEY,
    geometry JSON NOT NULL,
    CONSTRAINT fk_zone_boundary_location
        FOREIGN KEY (location_id) REFERENCES zone(location_id)
        ON DELETE CASCADE
);

CREATE TABLE trip (
    trip_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    pickup_datetime DATETIME NOT NULL,
    dropoff_datetime DATETIME NOT NULL,
    pickup_location_id SMALLINT NOT NULL,
    dropoff_location_id SMALLINT NOT NULL,
    passenger_count TINYINT NULL,
    trip_distance_mi DECIMAL(8,2) NOT NULL,
    rate_code_id TINYINT NULL,
    payment_type TINYINT NULL,
    fare_amount DECIMAL(8,2) NOT NULL,
    extra DECIMAL(6,2) NOT NULL DEFAULT 0.00,
    mta_tax DECIMAL(6,2) NOT NULL DEFAULT 0.00,
    tip_amount DECIMAL(8,2) NOT NULL DEFAULT 0.00,
    tolls_amount DECIMAL(8,2) NOT NULL DEFAULT 0.00,
    improvement_surcharge DECIMAL(6,2) NOT NULL DEFAULT 0.00,
    congestion_surcharge DECIMAL(6,2) NOT NULL DEFAULT 0.00,
    total_amount DECIMAL(8,2) NOT NULL,
    trip_duration_min DECIMAL(8,2) NOT NULL,
    avg_speed_mph DECIMAL(6,2) NULL,
    tip_percentage DECIMAL(8,2) NULL,
    is_airport_trip TINYINT(1) NOT NULL DEFAULT 0,
    CONSTRAINT fk_trip_pickup_zone
        FOREIGN KEY (pickup_location_id) REFERENCES zone(location_id),
    CONSTRAINT fk_trip_dropoff_zone
        FOREIGN KEY (dropoff_location_id) REFERENCES zone(location_id)
);

CREATE TABLE excluded_record_log (
    exclusion_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    source_row_ref VARCHAR(64) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    raw_data JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_trip_pickup_datetime ON trip (pickup_datetime);
CREATE INDEX idx_trip_dropoff_datetime ON trip (dropoff_datetime);
CREATE INDEX idx_trip_pickup_zone ON trip (pickup_location_id);
CREATE INDEX idx_trip_dropoff_zone ON trip (dropoff_location_id);
CREATE INDEX idx_trip_payment_type ON trip (payment_type);
CREATE INDEX idx_trip_rate_code ON trip (rate_code_id);
CREATE INDEX idx_trip_distance ON trip (trip_distance_mi);
CREATE INDEX idx_trip_total_amount ON trip (total_amount);
CREATE INDEX idx_trip_airport_flag ON trip (is_airport_trip);
 