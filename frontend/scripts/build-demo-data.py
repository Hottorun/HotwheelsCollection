"""Build the public demo's data from the local Supabase export.

Reads migration/export/ (gitignored, personal) and writes:
  src/demo/data.json  - catalogue, series and one collection, with user ids and notes removed
  demo/images/        - small JPEG thumbnails of the car photos, copied into public/ at demo build time

Run from frontend/:  python3 scripts/build-demo-data.py
"""
import json
import subprocess
from pathlib import Path

EXPORT = Path("../migration/export")
OUT_JSON = Path("src/demo/data.json")
OUT_IMAGES = Path("demo/images")
THUMB_WIDTH = 480
# The demo shows a slice of the collection, not all of it. Whole series are kept
# so the series and completion views still add up.
MAX_CARS = 80

cars = json.loads((EXPORT / "all_cars.json").read_text())
series = json.loads((EXPORT / "series.json").read_text())
collection = json.loads((EXPORT / "user_collection.json").read_text())

# Biggest series first, so the slice has some depth rather than 80 one-offs.
cars_by_series: dict = {}
for car in cars:
    cars_by_series.setdefault(car["series_id"], []).append(car)
kept_series = set()
kept = 0
for series_id, members in sorted(cars_by_series.items(), key=lambda kv: -len(kv[1])):
    if series_id and kept + len(members) <= MAX_CARS:
        kept_series.add(series_id)
        kept += len(members)
cars = [c for c in cars if c["series_id"] in kept_series]
series = [s for s in series if s["id"] in kept_series]
car_ids = {c["id"] for c in cars}
collection = [e for e in collection if e["allcars_id"] in car_ids]

OUT_IMAGES.mkdir(parents=True, exist_ok=True)
for car in cars:
    source = next((EXPORT / "car-images").glob(f"{car['id']}.*"), None)
    if source is None:
        car["image_url"] = None
        continue
    target = OUT_IMAGES / f"{car['id']}.jpg"
    if not target.exists():
        subprocess.run(
            ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "70",
             "--resampleWidth", str(THUMB_WIDTH), str(source), "--out", str(target)],
            check=True, capture_output=True,
        )
    # Root-relative, so resolveImageUrl serves it from the same origin.
    car["image_url"] = f"/images/{car['id']}.jpg"

for entry in collection:
    entry.pop("user_id", None)
    entry["notes"] = None

# Drop thumbnails left over from an earlier, larger slice.
for stale in OUT_IMAGES.glob("*.jpg"):
    if stale.stem not in car_ids:
        stale.unlink()

OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
OUT_JSON.write_text(json.dumps({"cars": cars, "series": series, "collection": collection}))
print(f"{len(cars)} cars, {len(series)} series, {len(collection)} entries")
