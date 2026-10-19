"""สร้างแผนที่ HTML (Leaflet) จาก thailand_floods.csv

ใช้งาน:
    python eonet_thailand_floods.py   # ดึงข้อมูลก่อน
    python make_flood_map.py          # สร้าง thailand_floods_map.html
"""

import argparse
import csv
import json

HTML_TEMPLATE = """<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Thailand Flood Map</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<style>
  html, body { margin: 0; height: 100%; font-family: system-ui, "Segoe UI", Tahoma, sans-serif; }
  #map { position: absolute; inset: 0; }
  .panel { background: #fff; padding: 10px 12px; border-radius: 8px;
           box-shadow: 0 1px 6px rgba(0,0,0,.25); font-size: 13px; line-height: 1.5; }
  .panel h1 { font-size: 15px; margin: 0 0 4px; }
  .panel .muted { color: #666; }
  .swatch { display: inline-block; width: 12px; height: 12px; border-radius: 50%;
            margin-right: 6px; vertical-align: -1px; border: 1px solid #fff;
            box-shadow: 0 0 0 1px rgba(0,0,0,.3); }
  .panel label { display: block; cursor: pointer; }
  .popup b { font-size: 14px; }
</style>
</head>
<body>
<div id="map"></div>
<script>
const events = __DATA__;
const palette = { "2025": "#2a78d6", "2026": "#e0532f" };
const fallback = "#7a7a7a";

const map = L.map("map").setView([13.2, 100.9], 6);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18, attribution: "&copy; OpenStreetMap contributors | Data: NASA EONET / GDACS"
}).addTo(map);

// จัดกลุ่มตามปีเพื่อเปิด/ปิดได้
const groups = {};
events.forEach(e => {
  const year = e.date.slice(0, 4);
  const color = palette[year] || fallback;
  groups[year] = groups[year] || L.layerGroup().addTo(map);
  const marker = L.circleMarker([e.lat, e.lon], {
    radius: 9, color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.85
  });
  const status = e.closed ? `ปิดเมื่อ ${e.closed}` : "<b style='color:#c00'>ยังเกิดอยู่</b>";
  marker.bindPopup(
    `<div class="popup"><b>${e.title}</b><br>` +
    `วันที่: ${e.date}<br>${status}<br>` +
    `พิกัด: ${e.lat}, ${e.lon}<br>` +
    (e.source ? `<a href="${e.source}" target="_blank" rel="noopener">รายงาน GDACS</a>` : "") +
    `</div>`
  );
  marker.bindTooltip(`${e.date} · ${e.title}`);
  marker.addTo(groups[year]);
});

// แผงข้อมูล + ตัวกรองปี
const info = L.control({ position: "topright" });
info.onAdd = () => {
  const div = L.DomUtil.create("div", "panel");
  const years = Object.keys(groups).sort();
  div.innerHTML =
    `<h1>น้ำท่วมในประเทศไทย</h1>` +
    `<div class="muted">NASA EONET · ${events.length} เหตุการณ์</div><hr style="border:none;border-top:1px solid #eee">` +
    years.map(y => {
      const n = events.filter(e => e.date.startsWith(y)).length;
      return `<label><input type="checkbox" data-year="${y}" checked> ` +
             `<span class="swatch" style="background:${palette[y] || fallback}"></span>${y} (${n})</label>`;
    }).join("");
  L.DomEvent.disableClickPropagation(div);
  div.querySelectorAll("input").forEach(cb => cb.addEventListener("change", () => {
    const g = groups[cb.dataset.year];
    cb.checked ? g.addTo(map) : map.removeLayer(g);
  }));
  return div;
};
info.addTo(map);

if (events.length) {
  map.fitBounds(L.latLngBounds(events.map(e => [e.lat, e.lon])).pad(0.2));
}
</script>
</body>
</html>
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("-i", "--input", default="thailand_floods.csv")
    parser.add_argument("-o", "--output", default="thailand_floods_map.html")
    args = parser.parse_args()

    with open(args.input, encoding="utf-8-sig") as f:
        events = [
            {**row, "lat": float(row["lat"]), "lon": float(row["lon"])}
            for row in csv.DictReader(f)
        ]

    html = HTML_TEMPLATE.replace("__DATA__", json.dumps(events, ensure_ascii=False))
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"สร้างแผนที่ {len(events)} จุด -> {args.output}")


if __name__ == "__main__":
    main()
