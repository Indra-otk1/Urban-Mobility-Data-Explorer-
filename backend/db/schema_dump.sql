-- MySQL dump 10.13  Distrib 8.0.46, for Win64 (x86_64)
--
-- Host: localhost    Database: taxi_db
-- ------------------------------------------------------
-- Server version	8.0.46

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `dim_payment_type`
--

DROP TABLE IF EXISTS `dim_payment_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dim_payment_type` (
  `payment_type_id` tinyint NOT NULL,
  `description` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`payment_type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `dim_rate_code`
--

DROP TABLE IF EXISTS `dim_rate_code`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dim_rate_code` (
  `rate_code_id` tinyint NOT NULL,
  `description` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`rate_code_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `dim_vendor`
--

DROP TABLE IF EXISTS `dim_vendor`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dim_vendor` (
  `vendor_id` tinyint NOT NULL,
  `vendor_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`vendor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `dim_zone`
--

DROP TABLE IF EXISTS `dim_zone`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dim_zone` (
  `location_id` smallint NOT NULL,
  `borough` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `zone` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `service_zone` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `geom` geometry NOT NULL /*!80003 SRID 4326 */,
  `centroid_lat` decimal(9,6) DEFAULT NULL,
  `centroid_lng` decimal(9,6) DEFAULT NULL,
  PRIMARY KEY (`location_id`),
  SPATIAL KEY `idx_zone_geom` (`geom`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_trip`
--

DROP TABLE IF EXISTS `fact_trip`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_trip` (
  `trip_id` bigint NOT NULL AUTO_INCREMENT,
  `vendor_id` tinyint DEFAULT NULL,
  `pickup_datetime` datetime NOT NULL,
  `dropoff_datetime` datetime NOT NULL,
  `passenger_count` tinyint DEFAULT NULL,
  `trip_distance` decimal(8,2) DEFAULT NULL,
  `rate_code_id` tinyint DEFAULT NULL,
  `pu_location_id` smallint DEFAULT NULL,
  `do_location_id` smallint DEFAULT NULL,
  `payment_type_id` tinyint DEFAULT NULL,
  `fare_amount` decimal(8,2) DEFAULT NULL,
  `extra` decimal(6,2) DEFAULT NULL,
  `mta_tax` decimal(6,2) DEFAULT NULL,
  `tip_amount` decimal(8,2) DEFAULT NULL,
  `tolls_amount` decimal(8,2) DEFAULT NULL,
  `improvement_surcharge` decimal(6,2) DEFAULT NULL,
  `total_amount` decimal(8,2) DEFAULT NULL,
  `congestion_surcharge` decimal(6,2) DEFAULT NULL,
  `airport_fee` decimal(6,2) DEFAULT NULL,
  `trip_duration_min` decimal(8,2) DEFAULT NULL,
  `avg_speed_mph` decimal(6,2) DEFAULT NULL,
  `tip_percentage` decimal(7,2) DEFAULT NULL,
  `is_airport_trip` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`trip_id`),
  KEY `fk_trip_vendor` (`vendor_id`),
  KEY `fk_trip_rate` (`rate_code_id`),
  KEY `idx_trip_pickup_time` (`pickup_datetime`),
  KEY `idx_trip_pu_zone` (`pu_location_id`),
  KEY `idx_trip_do_zone` (`do_location_id`),
  KEY `idx_trip_payment` (`payment_type_id`),
  CONSTRAINT `fk_trip_do_zone` FOREIGN KEY (`do_location_id`) REFERENCES `dim_zone` (`location_id`),
  CONSTRAINT `fk_trip_payment` FOREIGN KEY (`payment_type_id`) REFERENCES `dim_payment_type` (`payment_type_id`),
  CONSTRAINT `fk_trip_pu_zone` FOREIGN KEY (`pu_location_id`) REFERENCES `dim_zone` (`location_id`),
  CONSTRAINT `fk_trip_rate` FOREIGN KEY (`rate_code_id`) REFERENCES `dim_rate_code` (`rate_code_id`),
  CONSTRAINT `fk_trip_vendor` FOREIGN KEY (`vendor_id`) REFERENCES `dim_vendor` (`vendor_id`)
) ENGINE=InnoDB AUTO_INCREMENT=7385318 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-06-16 23:37:37
