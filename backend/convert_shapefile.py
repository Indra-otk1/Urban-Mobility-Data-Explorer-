import shapefile
import json

# Update this path to wherever you put the shapefile
sf = shapefile.Reader("data/taxi_zones.shp")

features = []
for shape_rec in sf.shapeRecords():
    geom = shape_rec.shape.__geo_interface__
    props = shape_rec.record.as_dict()
    features.append({
        "type": "Feature",
        "properties": props,
        "geometry": geom
    })

geojson = {
    "type": "FeatureCollection",
    "features": features
}

with open("data/taxi_zones.geojson", "w") as f:
    json.dump(geojson, f)

print(f"Done. Converted {len(features)} zones.")