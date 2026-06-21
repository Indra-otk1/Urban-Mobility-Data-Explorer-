"""
generate_zone_sql.py
Reads taxi_zone_lookup.csv + taxi_zones shapefile, reprojects polygons
from NY State Plane (EPSG:2263) to WGS84 (EPSG:4326), and writes
zone_data.sql with INSERT statements for dim_zone.

Usage:
    pip install pyshp pyproj --break-system-packages
    python generate_zone_sql.py
"""

import csv
import shapefile
from pyproj import Transformer

LOOKUP_CSV = "taxi_zone_lookup.csv"
SHAPEFILE_PATH = "taxi_zones/taxi_zones.shp"  # adjust if you unzipped elsewhere
OUTPUT_SQL = "zone_data.sql"

transformer = Transformer.from_crs("EPSG:2263", "EPSG:4326", always_xy=True)


def load_lookup(path):
    lookup = {}
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            lookup[int(row["LocationID"])] = {
                "borough": row["Borough"],
                "zone": row["Zone"],
                "service_zone": row["service_zone"],
            }
    return lookup


def reproject_ring(points):
    return [transformer.transform(x, y) for x, y in points]


def ring_to_wkt(points):
    coords = ", ".join(f"{lng} {lat}" for lng, lat in points)
    return f"({coords})"


def shape_to_polygon_wkt(shape):
    """
    Convert a pyshp shape (POLYGON, possibly with multiple parts/holes)
    to a MySQL MULTIPOLYGON WKT string.
    Each 'part' that is a separate outer ring becomes its own polygon
    in the multipolygon (simplification: treats each part as its own
    polygon — good enough for storage/display purposes).
    """
    parts = list(shape.parts) + [len(shape.points)]
    polygons = []
    for i in range(len(parts) - 1):
        start, end = parts[i], parts[i + 1]
        ring = shape.points[start:end]
        ring_proj = reproject_ring(ring)
        polygons.append(f"({ring_to_wkt(ring_proj)})")
    return f"MULTIPOLYGON({', '.join(polygons)})"


def compute_centroid(shape):
    pts = reproject_ring(shape.points)
    n = len(pts)
    lng = sum(p[0] for p in pts) / n
    lat = sum(p[1] for p in pts) / n
    return lat, lng


def main():
    lookup = load_lookup(LOOKUP_CSV)
    sf = shapefile.Reader(SHAPEFILE_PATH)

    # Group shapes by LocationID (some zones, e.g. 56 - Corona, have
    # multiple disconnected shape records for the same LocationID)
    zone_shapes = {}
    for sr in sf.iterShapeRecords():
        loc_id = int(sr.record["LocationID"])
        zone_shapes.setdefault(loc_id, []).append(sr.shape)

    rows = []
    for loc_id, shapes in zone_shapes.items():
        info = lookup.get(loc_id)
        if not info:
            continue

        all_polygons = []
        all_points = []
        for shape in shapes:
            wkt = shape_to_polygon_wkt(shape)  # "MULTIPOLYGON(...)"
            inner = wkt[len("MULTIPOLYGON("):-1]
            all_polygons.append(inner)
            all_points.extend(shape.points)

        merged_wkt = f"MULTIPOLYGON({', '.join(all_polygons)})"

        # Centroid across all points from all shapes for this LocationID
        pts = reproject_ring(all_points)
        lng = sum(p[0] for p in pts) / len(pts)
        lat = sum(p[1] for p in pts) / len(pts)

        rows.append((loc_id, info["borough"], info["zone"], info["service_zone"], merged_wkt, lat, lng))


    with open(OUTPUT_SQL, "w", encoding="utf-8") as f:
        f.write("USE taxi_db;\n\n")
        for loc_id, borough, zone, service_zone, wkt, lat, lng in rows:
            borough_e = borough.replace("'", "\\'")
            zone_e = zone.replace("'", "\\'")
            service_zone_e = (service_zone or "").replace("'", "\\'")
            f.write(
                "INSERT INTO dim_zone "
                "(location_id, borough, zone, service_zone, geom, centroid_lat, centroid_lng) "
                f"VALUES ({loc_id}, '{borough_e}', '{zone_e}', '{service_zone_e}', "
                f"ST_GeomFromText('{wkt}', 4326), {lat:.6f}, {lng:.6f});\n"
            )

    print(f"Wrote {len(rows)} zone records to {OUTPUT_SQL}")


if __name__ == "__main__":
    main()
