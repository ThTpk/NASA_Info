"""ดึงข้อมูลเหตุการณ์น้ำท่วมในประเทศไทยจาก NASA EONET API แล้วบันทึกเป็น CSV

ใช้งาน:
    python eonet_thailand_floods.py              # ทุกเหตุการณ์ (ทั้งที่จบแล้วและยังเกิดอยู่)
    python eonet_thailand_floods.py --days 365   # ย้อนหลัง N วัน
    python eonet_thailand_floods.py --open       # เฉพาะเหตุการณ์ที่ยังไม่ปิด
"""

import argparse
import csv
import json
import urllib.request
from urllib.parse import urlencode

EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events"
# กรอบพิกัดประเทศไทย: min_lon, max_lat, max_lon, min_lat
THAILAND_BBOX = "97.3,20.5,105.7,5.6"


def fetch_events(status="all", days=None):
    params = {"category": "floods", "status": status, "bbox": THAILAND_BBOX, "limit": 1000}
    if days:
        params["days"] = days
    with urllib.request.urlopen(f"{EONET_URL}?{urlencode(params)}", timeout=60) as resp:
        return json.load(resp)["events"]


def centroid(geometry):
    """คืนค่า (lon, lat) ของจุด หรือจุดกึ่งกลางของ polygon"""
    coords = geometry["coordinates"]
    if geometry["type"] == "Point":
        return coords[0], coords[1]
    ring = coords[0]  # Polygon: ใช้วงนอก
    lon = sum(p[0] for p in ring) / len(ring)
    lat = sum(p[1] for p in ring) / len(ring)
    # polygon จาก GDACS บางชุดเรียงเป็น [lat, lon] ผิดจากมาตรฐาน GeoJSON
    # ประเทศไทยมี lon ~97-106 และ lat ~5-21 จึงสลับกลับถ้าค่าอยู่ผิดช่วง
    if lon < 90 and lat > 90:
        lon, lat = lat, lon
    return lon, lat


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, help="ย้อนหลังกี่วัน")
    parser.add_argument("--open", action="store_true", help="เฉพาะเหตุการณ์ที่ยังไม่ปิด")
    parser.add_argument("--all-countries", action="store_true",
                        help="รวมเหตุการณ์ในประเทศเพื่อนบ้านที่อยู่ในกรอบพิกัดด้วย")
    parser.add_argument("-o", "--output", default="thailand_floods.csv")
    args = parser.parse_args()

    events = fetch_events("open" if args.open else "all", args.days)
    if not args.all_countries:
        # กรอบพิกัดครอบคลุมลาว กัมพูชา ฯลฯ ด้วย จึงกรองจากชื่อเหตุการณ์
        events = [e for e in events if "Thailand" in e["title"]]

    rows = []
    for e in events:
        geo = e["geometry"][0]
        lon, lat = centroid(geo)
        rows.append({
            "id": e["id"],
            "title": e["title"],
            "date": geo["date"][:10],
            "closed": (e["closed"] or "")[:10],
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "geometry_type": geo["type"],
            "source": e["sources"][0]["url"] if e["sources"] else "",
        })

    with open(args.output, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else ["id"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"พบ {len(rows)} เหตุการณ์ -> บันทึกที่ {args.output}")
    for r in rows:
        status = "ยังเกิดอยู่" if not r["closed"] else f"ปิด {r['closed']}"
        print(f"{r['date']}  {r['title']:<45} ({r['lat']}, {r['lon']})  {status}")


if __name__ == "__main__":
    main()
