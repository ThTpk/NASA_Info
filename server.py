"""เซิร์ฟเวอร์สำหรับระบบแผนที่ติดตามน้ำท่วม / PM / ฝน (monitor/)

ทำหน้าที่ 2 อย่าง:
1. เสิร์ฟไฟล์ static ในโฟลเดอร์โปรเจกต์
2. เป็น proxy ให้ API ที่เบราว์เซอร์เรียกตรงไม่ได้ (ไม่มี CORS) พร้อม cache

    /api/air4thai           ค่าฝุ่น PM2.5 ล่าสุดจากสถานีกรมควบคุมมลพิษ (cache 10 นาที)
    /api/gibs-latest        วันที่ล่าสุดที่มีข้อมูลของทุกชั้น GIBS (cache 3 ชั่วโมง)
    /api/reverse?lat=&lon=  ชื่อสถานที่จากพิกัด (Nominatim, cache)
    /api/search?q=          ค้นหาสถานที่ในไทย (Nominatim, cache)

ใช้งาน:
    python server.py            # เปิดที่ http://localhost:8770/monitor/
    python server.py --port 9000
"""

import argparse
import json
import ssl
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent
USER_AGENT = "nasa-api-thailand-monitor/1.0 (local research tool)"
AIR4THAI_URL = "https://air4thai.pcd.go.th/services/getNewAQI_JSON.php"
GIBS_CAPS_URL = ("https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi"
                 "?SERVICE=WMTS&REQUEST=GetCapabilities")
NOMINATIM = "https://nominatim.openstreetmap.org"

_cache = {}
_cache_lock = threading.Lock()
_nominatim_lock = threading.Lock()
_nominatim_last = [0.0]


def cached(key, ttl, fn):
    with _cache_lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
    value = fn()
    with _cache_lock:
        _cache[key] = (time.time(), value)
    return value


def http_get(url, context=None, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "th,en"})
    with urllib.request.urlopen(req, timeout=timeout, context=context) as resp:
        return resp.read()


def fetch_air4thai():
    try:
        raw = http_get(AIR4THAI_URL)
    except urllib.error.URLError as e:
        if "CERTIFICATE_VERIFY_FAILED" not in str(e):
            raise
        # เซิร์ฟเวอร์ air4thai ส่ง certificate chain ไม่ครบ ทำให้ Python ตรวจสอบไม่ผ่าน
        # ยอมข้ามการตรวจสอบเฉพาะ endpoint สาธารณะแบบอ่านอย่างเดียวนี้เท่านั้น
        raw = http_get(AIR4THAI_URL, context=ssl._create_unverified_context())
    stations = []
    for s in json.loads(raw)["stations"]:
        last = s.get("AQILast") or {}
        pm25 = last.get("PM25") or {}
        try:
            value = float(pm25.get("value", -1))
        except ValueError:
            value = -1
        stations.append({
            "id": s["stationID"], "name": s["nameTH"], "area": s["areaTH"],
            "lat": float(s["lat"]), "lon": float(s["long"]),
            "date": last.get("date"), "time": last.get("time"),
            "pm25": value if value >= 0 else None,
            "color_id": pm25.get("color_id"),
            "aqi": (last.get("AQI") or {}).get("aqi"),
        })
    return {"updated": time.strftime("%Y-%m-%d %H:%M"), "stations": stations}


def fetch_gibs_latest():
    W = "{http://www.opengis.net/wmts/1.0}"
    O = "{http://www.opengis.net/ows/1.1}"
    root = ET.fromstring(http_get(GIBS_CAPS_URL, timeout=180))
    latest = {}
    for layer in root.iter(W + "Layer"):
        dim = layer.find(W + "Dimension")
        if dim is None:
            continue
        values = dim.findall(W + "Value")
        latest[layer.find(O + "Identifier").text] = {
            "default": dim.find(W + "Default").text,
            "end": values[-1].text.split("/")[1] if values and "/" in values[-1].text else None,
        }
    return latest


def nominatim(path, params):
    params = {**params, "format": "jsonv2", "accept-language": "th"}
    url = f"{NOMINATIM}/{path}?{urllib.parse.urlencode(params)}"

    def call():
        # นโยบาย Nominatim: ไม่เกิน 1 request ต่อวินาที
        with _nominatim_lock:
            wait = 1.0 - (time.time() - _nominatim_last[0])
            if wait > 0:
                time.sleep(wait)
            _nominatim_last[0] = time.time()
            return json.loads(http_get(url, timeout=30))
    return cached(url, 24 * 3600, call)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        try:
            if url.path == "/api/air4thai":
                return self.send_json(cached("air4thai", 600, fetch_air4thai))
            if url.path == "/api/gibs-latest":
                return self.send_json(cached("gibs", 3 * 3600, fetch_gibs_latest))
            if url.path == "/api/reverse":
                lat, lon = float(q["lat"]), float(q["lon"])
                return self.send_json(nominatim("reverse", {"lat": f"{lat:.4f}", "lon": f"{lon:.4f}", "zoom": 14}))
            if url.path == "/api/search":
                return self.send_json(nominatim("search", {"q": q.get("q", "")[:100], "countrycodes": "th", "limit": 6}))
        except Exception as e:  # ส่ง error กลับเป็น JSON ให้หน้าเว็บแสดงผลได้
            return self.send_json({"error": str(e)}, status=502)
        if url.path in ("/", ""):
            self.send_response(302)
            self.send_header("Location", "/monitor/")
            return self.end_headers()
        return super().do_GET()

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8770)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    # โหลดรายการชั้น GIBS (~6 MB) ไว้ก่อน ผู้ใช้คนแรกจะได้ไม่ต้องรอ
    threading.Thread(target=lambda: cached("gibs", 3 * 3600, fetch_gibs_latest), daemon=True).start()
    print(f"เปิดระบบแผนที่ที่ http://localhost:{args.port}/monitor/")
    server.serve_forever()


if __name__ == "__main__":
    main()
