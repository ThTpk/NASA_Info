"""สร้างแผนที่ลูกโลก 3 มิติแบบหมุนได้ (MapLibre GL) จาก thailand_floods.csv

ใช้งาน:
    python eonet_thailand_floods.py   # ดึงข้อมูลก่อน
    python make_flood_globe.py        # สร้าง thailand_floods_globe.html
"""

import argparse
import csv
import json

HTML_TEMPLATE = """<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Thailand Flood Globe</title>
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.0.0/dist/maplibre-gl.css">
<script src="https://unpkg.com/maplibre-gl@5.0.0/dist/maplibre-gl.js"></script>
<style>
  html, body { margin: 0; height: 100%; background: #05070d;
               font-family: system-ui, "Segoe UI", Tahoma, sans-serif; }
  #map { position: absolute; inset: 0; }
  .panel { position: absolute; top: 12px; left: 12px; z-index: 1; width: 260px;
           max-height: calc(100% - 24px); overflow-y: auto; box-sizing: border-box;
           background: rgba(16,20,30,.86); color: #e8ecf3; padding: 12px 14px;
           border-radius: 10px; font-size: 13px; line-height: 1.6;
           box-shadow: 0 2px 12px rgba(0,0,0,.4); }
  .panel h1 { font-size: 15px; margin: 0 0 2px; }
  .panel h2 { font-size: 12px; margin: 0 0 4px; color: #9aa4b5; font-weight: 600;
              text-transform: uppercase; letter-spacing: .04em; }
  .panel .muted { color: #9aa4b5; }
  .panel hr { border: none; border-top: 1px solid rgba(255,255,255,.12); margin: 8px 0; }
  .panel label { display: block; cursor: pointer; }
  .panel select, .panel input[type=date] {
    width: 100%; box-sizing: border-box; padding: 4px 6px; border-radius: 6px; font: inherit;
    background: rgba(255,255,255,.08); color: inherit; border: 1px solid rgba(255,255,255,.25);
    color-scheme: dark; }
  .panel select option { background: #1a1f2b; }
  .swatch { display: inline-block; width: 11px; height: 11px; border-radius: 50%;
            margin-right: 6px; vertical-align: -1px; border: 1px solid #fff; }
  .panel button { margin: 2px 4px 2px 0; padding: 4px 9px; border-radius: 6px; cursor: pointer;
                  border: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.08);
                  color: inherit; font: inherit; }
  .panel button.on { background: #2a78d6; border-color: #2a78d6; }
  .panel #toggle { margin: 0 6px 0 0; padding: 0 6px; }
  .panel.collapsed .body { display: none; }
  .hint { font-size: 12px; }
  .row { margin-top: 4px; }
  .maplibregl-popup-content { font-size: 13px; line-height: 1.5; }
  .maplibregl-popup-content button { margin-top: 4px; cursor: pointer; }
</style>
</head>
<body>
<div id="map"></div>
<div class="panel">
  <h1><button id="toggle" title="ย่อ/ขยาย">▾</button>น้ำท่วมในประเทศไทย</h1>
  <div class="body">
  <div class="muted">NASA EONET · <span id="count"></span> เหตุการณ์</div>
  <hr>
  <div id="years"></div>
  <hr>
  <h2>แผนที่พื้นหลัง</h2>
  <select id="basemap"></select>
  <div class="row" id="date-row">
    <span class="muted">วันที่ของภาพ (ภาพรายวัน / ฝน)</span>
    <input type="date" id="date">
  </div>
  <div class="row">
    <label><input type="checkbox" id="labels" checked> ชื่อสถานที่</label>
    <label><input type="checkbox" id="rain"> ปริมาณฝน NASA IMERG</label>
    <label><input type="checkbox" id="terrain"> ภูมิประเทศ 3 มิติ</label>
  </div>
  <hr>
  <div>
    <button id="spin" class="on">หมุนอัตโนมัติ</button>
    <button id="proj">มุมมองแบน</button>
    <button id="home">กลับไปที่ไทย</button>
  </div>
  <hr>
  <div class="muted hint">ลาก = หมุนลูกโลก · คลิกขวาลาก / Ctrl+ลาก = เอียงและหมุนทิศ · สกรอล = ซูม</div>
  </div>
</div>
<script>
const events = __DATA__;
const palette = { "2025": "#3d8bff", "2026": "#ff6a3d" };
const fallback = "#bbbbbb";
const THAI = { center: [100.9, 13.2], zoom: 4.6, pitch: 35, bearing: -10 };
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";

// ภาพรายวันของ NASA ใช้เวลาประมวลผล 1-2 วัน จึงตั้งค่าเริ่มต้นย้อนหลัง 2 วัน
const defaultDate = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
const dateInput = document.getElementById("date");
dateInput.value = defaultDate;
dateInput.max = new Date().toISOString().slice(0, 10);

// labels: ชั้นชื่อสถานที่ที่จะซ้อนทับ (null = แผนที่มีชื่ออยู่แล้ว)
// หมายเหตุ: CARTO basemaps ต้องใช้ API key แล้ว (ขึ้นลายน้ำ) จึงใช้ Esri แทน
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
const LABEL_TILES = {
  places: ESRI + "Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  darkgray: ESRI + "Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
};
const BASEMAPS = [
  { id: "bluemarble", name: "NASA Blue Marble (ภูมิประเทศ + ทะเลลึก)", labels: "places", maxzoom: 8,
    url: () => GIBS + "BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
    attribution: "NASA GIBS Blue Marble" },
  { id: "blackmarble", name: "NASA Black Marble (แสงไฟกลางคืน)", labels: "places", maxzoom: 8,
    url: () => GIBS + "VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png",
    attribution: "NASA GIBS Black Marble" },
  { id: "viirs", name: "NASA VIIRS ภาพถ่ายรายวัน", labels: "places", maxzoom: 9, daily: true,
    url: d => GIBS + `VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${d}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg`,
    attribution: "NASA GIBS VIIRS SNPP" },
  { id: "modis", name: "NASA MODIS Terra ภาพถ่ายรายวัน", labels: "places", maxzoom: 9, daily: true,
    url: d => GIBS + `MODIS_Terra_CorrectedReflectance_TrueColor/default/${d}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg`,
    attribution: "NASA GIBS MODIS Terra" },
  { id: "sentinel", name: "Sentinel-2 ไร้เมฆ (ความละเอียดสูง)", labels: "places", maxzoom: 15,
    url: () => "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg",
    attribution: "Sentinel-2 cloudless 2024 by EOX IT Services GmbH (CC BY-NC-SA 4.0)" },
  { id: "esri", name: "Esri ดาวเทียมความละเอียดสูง", labels: "places", maxzoom: 19,
    url: () => ESRI + "World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics" },
  { id: "darkgray", name: "Esri Dark Gray (โทนมืด)", labels: "darkgray", maxzoom: 16,
    url: () => ESRI + "Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri, HERE, Garmin, OpenStreetMap" },
  { id: "natgeo", name: "National Geographic (สไตล์แผนที่โลก)", labels: null, maxzoom: 16,
    url: () => ESRI + "NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; National Geographic, Esri, Garmin, HERE" },
  { id: "esritopo", name: "Esri World Topo (ภูมิประเทศ)", labels: null, maxzoom: 19,
    url: () => ESRI + "World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri, HERE, Garmin, OpenStreetMap" },
  { id: "ocean", name: "Esri Ocean (ความลึกทะเล)", labels: "places", maxzoom: 13,
    url: () => ESRI + "Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri, GEBCO, NOAA, National Geographic" },
  { id: "topo", name: "OpenTopoMap (เส้นชั้นความสูง)", labels: null, maxzoom: 17,
    url: () => "https://tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap, SRTM | OpenTopoMap (CC-BY-SA)" },
  { id: "osm", name: "OpenStreetMap", labels: null, maxzoom: 19,
    url: () => "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors" },
];
const rainUrl = d => GIBS + `IMERG_Precipitation_Rate/default/${d}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`;

const geojson = {
  type: "FeatureCollection",
  features: events.map(e => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [e.lon, e.lat] },
    properties: { ...e, year: e.date.slice(0, 4) }
  }))
};
const yearColor = ["match", ["get", "year"], "2025", palette["2025"], "2026", palette["2026"], fallback];

const sources = {
  labels: { type: "raster", tileSize: 256, maxzoom: 20, tiles: [LABEL_TILES.places],
            attribution: "Labels &copy; Esri" },
  rain: { type: "raster", tileSize: 256, maxzoom: 6, tiles: [rainUrl(defaultDate)],
          attribution: "Rain: NASA GPM IMERG" },
  dem: { type: "raster-dem", tileSize: 256, maxzoom: 14, encoding: "terrarium",
         tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
         attribution: "Terrain: Mapzen / AWS Open Data" },
  floods: { type: "geojson", data: geojson },
};
const layers = [];
BASEMAPS.forEach((b, i) => {
  sources["base-" + b.id] = { type: "raster", tileSize: 256, maxzoom: b.maxzoom,
                              tiles: [b.url(defaultDate)], attribution: b.attribution };
  layers.push({ id: "base-" + b.id, type: "raster", source: "base-" + b.id,
                layout: { visibility: i === 0 ? "visible" : "none" } });
});
layers.push(
  { id: "hillshade", type: "hillshade", source: "dem", layout: { visibility: "none" },
    paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#0b0e14" } },
  { id: "rain", type: "raster", source: "rain", layout: { visibility: "none" },
    paint: { "raster-opacity": 0.75 } },
  { id: "labels", type: "raster", source: "labels" },
  { id: "flood-glow", type: "circle", source: "floods", paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 6, 6, 18],
      "circle-color": yearColor, "circle-opacity": 0.25, "circle-blur": 0.6 } },
  { id: "flood-points", type: "circle", source: "floods", paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 3, 6, 8],
      "circle-color": yearColor, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } }
);

const map = new maplibregl.Map({
  container: "map",
  center: [100.9, 13.2],
  zoom: 1.6,
  maxPitch: 80,
  style: {
    version: 8,
    projection: { type: "globe" },
    sources, layers,
    sky: { "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 6, 0] }
  },
  attributionControl: { compact: true, customAttribution: "Data: NASA EONET / GDACS" }
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

// ---------- ตัวกรองปี ----------
document.getElementById("count").textContent = events.length;
const years = [...new Set(events.map(e => e.date.slice(0, 4)))].sort();
const active = new Set(years);
document.getElementById("years").innerHTML = years.map(y => {
  const n = events.filter(e => e.date.startsWith(y)).length;
  return `<label><input type="checkbox" data-year="${y}" checked> ` +
         `<span class="swatch" style="background:${palette[y] || fallback}"></span>${y} (${n})</label>`;
}).join("");
document.querySelectorAll("#years input").forEach(cb => cb.addEventListener("change", () => {
  cb.checked ? active.add(cb.dataset.year) : active.delete(cb.dataset.year);
  const filter = ["in", ["get", "year"], ["literal", [...active]]];
  map.setFilter("flood-points", filter);
  map.setFilter("flood-glow", filter);
}));

// ---------- แผนที่พื้นหลัง / ชั้นข้อมูล ----------
const baseSelect = document.getElementById("basemap");
baseSelect.innerHTML = BASEMAPS.map(b => `<option value="${b.id}">${b.name}</option>`).join("");
const labelsBox = document.getElementById("labels");
const rainBox = document.getElementById("rain");
const terrainBox = document.getElementById("terrain");
let current = BASEMAPS[0];

function vis(id, on) { map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); }

function applyLabels() {
  const style = current.labels;
  labelsBox.disabled = !style;
  labelsBox.parentElement.style.opacity = style ? 1 : 0.45;
  if (style) map.getSource("labels").setTiles([LABEL_TILES[style]]);
  vis("labels", !!style && labelsBox.checked);
}

function setBasemap(id) {
  current = BASEMAPS.find(b => b.id === id);
  BASEMAPS.forEach(b => vis("base-" + b.id, b.id === id));
  applyLabels();
}

function applyDate() {
  const d = dateInput.value || defaultDate;
  BASEMAPS.filter(b => b.daily).forEach(b => map.getSource("base-" + b.id).setTiles([b.url(d)]));
  map.getSource("rain").setTiles([rainUrl(d)]);
}

function applyTerrain() {
  const on = terrainBox.checked;
  map.setTerrain(on ? { source: "dem", exaggeration: 1.5 } : null);
  vis("hillshade", on);
  if (on && map.getPitch() < 45) map.easeTo({ pitch: 60, duration: 1200 });
}

// ถ้าผู้ใช้กดก่อน style โหลดเสร็จ ให้รอ load ก่อนค่อยทำ
let ready = false;
const whenReady = fn => (...a) => ready ? fn(...a) : map.once("load", () => fn(...a));
baseSelect.onchange = whenReady(() => setBasemap(baseSelect.value));
dateInput.onchange = whenReady(applyDate);
labelsBox.onchange = whenReady(applyLabels);
rainBox.onchange = whenReady(() => vis("rain", rainBox.checked));
terrainBox.onchange = whenReady(applyTerrain);

// ---------- popup ----------
map.on("click", "flood-points", ev => {
  const p = ev.features[0].properties;
  const status = p.closed ? `ปิดเมื่อ ${p.closed}` : "<b style='color:#c00'>ยังเกิดอยู่</b>";
  const html = `<b>${p.title}</b><br>วันที่: ${p.date}<br>${status}<br>พิกัด: ${p.lat}, ${p.lon}<br>` +
    (p.source ? `<a href="${p.source}" target="_blank" rel="noopener">รายงาน GDACS</a><br>` : "") +
    `<button data-date="${p.date}">ดูภาพดาวเทียม + ฝนวันนั้น</button>`;
  const popup = new maplibregl.Popup({ offset: 10 })
    .setLngLat(ev.features[0].geometry.coordinates).setHTML(html).addTo(map);
  popup.getElement().querySelector("button").onclick = () => {
    stopSpin();
    dateInput.value = p.date;
    applyDate();
    baseSelect.value = "viirs";
    setBasemap("viirs");
    rainBox.checked = true;
    vis("rain", true);
    map.flyTo({ center: ev.features[0].geometry.coordinates, zoom: 6.5, duration: 2000 });
  };
});
map.on("mouseenter", "flood-points", () => map.getCanvas().style.cursor = "pointer");
map.on("mouseleave", "flood-points", () => map.getCanvas().style.cursor = "");

// ---------- หมุนอัตโนมัติ ----------
let spinning = true, userBusy = false;
const spinBtn = document.getElementById("spin");
function spin() {
  if (!spinning || userBusy || map.getZoom() > 4) return;
  const c = map.getCenter();
  map.easeTo({ center: [c.lng - 6, c.lat], duration: 1000, easing: t => t });
}
map.on("mousedown", () => userBusy = true);
map.on("touchstart", () => userBusy = true);
map.on("mouseup", () => { userBusy = false; spin(); });
map.on("touchend", () => { userBusy = false; spin(); });
map.on("moveend", spin);
spinBtn.onclick = () => {
  spinning = !spinning;
  spinBtn.classList.toggle("on", spinning);
  if (spinning) spin();
};
function stopSpin() { spinning = false; spinBtn.classList.remove("on"); }

// ---------- ปุ่มอื่น ๆ ----------
// เลื่อนจุดกึ่งกลางหลบแผงข้อมูล: จอกว้างหลบทางซ้าย จอแคบหลบด้านบน
const panel = document.querySelector(".panel");
function panelPadding() {
  const r = panel.getBoundingClientRect();
  return innerWidth > 700
    ? { left: r.right, top: 0, right: 0, bottom: 0 }
    : { top: r.bottom, left: 0, right: 0, bottom: 0 };
}
document.getElementById("home").onclick = () => {
  stopSpin();
  map.flyTo({ ...THAI, padding: panelPadding(), duration: 2500 });
};
document.getElementById("toggle").onclick = () => {
  panel.classList.toggle("collapsed");
  document.getElementById("toggle").textContent = panel.classList.contains("collapsed") ? "▸" : "▾";
};

let globe = true;
const projBtn = document.getElementById("proj");
projBtn.onclick = () => {
  globe = !globe;
  map.setProjection({ type: globe ? "globe" : "mercator" });
  projBtn.textContent = globe ? "มุมมองแบน" : "มุมมองลูกโลก";
};

map.on("load", () => { ready = true; spin(); });
</script>
</body>
</html>
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("-i", "--input", default="thailand_floods.csv")
    parser.add_argument("-o", "--output", default="thailand_floods_globe.html")
    args = parser.parse_args()

    with open(args.input, encoding="utf-8-sig") as f:
        events = [
            {**row, "lat": float(row["lat"]), "lon": float(row["lon"])}
            for row in csv.DictReader(f)
        ]

    html = HTML_TEMPLATE.replace("__DATA__", json.dumps(events, ensure_ascii=False))
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"สร้างลูกโลก {len(events)} จุด -> {args.output}")


if __name__ == "__main__":
    main()
