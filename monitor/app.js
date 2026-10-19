// ระบบแผนที่ติดตามน้ำท่วม / ฝุ่น PM / ฝน จากดาวเทียม
// แหล่งข้อมูล: NASA GIBS (WMTS/WMS + colormap), NASA EONET, Air4Thai, Nominatim

const GIBS = "https://gibs.earthdata.nasa.gov/";
const WMTS = GIBS + "wmts/epsg3857/best/";
const WMS = GIBS + "wms/epsg3857/best/wms.cgi";
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
const THAILAND = [[97.3, 5.6], [105.7, 20.5]];

// ---------------------------------------------------------------- แหล่งข้อมูลที่ไม่ใช่ภาพ
// เปิดผ่าน server.py -> ใช้ /api (ข้อมูลสด)
// เปิดบน GitHub Pages -> ใช้ไฟล์ data/*.json ที่ GitHub Actions อัปเดตทุกชั่วโมง และเรียก Nominatim ตรง
const NOMINATIM = "https://nominatim.openstreetmap.org/";
async function getJSON(...urls) {
  let lastErr;
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      return d;
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}
// บน GitHub Pages ไม่มี /api จึงข้ามไปใช้ตัวสำรองเลย ไม่ต้องรอ 404
const HAS_SERVER = ["localhost", "127.0.0.1"].includes(location.hostname);
const pick = (server, fallback) => getJSON(...(HAS_SERVER ? [server, fallback] : [fallback]));
const api = {
  air4thai: () => pick("/api/air4thai", "data/air4thai.json"),
  gibsLatest: () => pick("/api/gibs-latest", "data/gibs-latest.json"),
  reverse: (lat, lon) => pick(`/api/reverse?lat=${lat}&lon=${lon}`,
    `${NOMINATIM}reverse?format=jsonv2&accept-language=th&zoom=14&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`),
  search: q => pick(`/api/search?q=${encodeURIComponent(q)}`,
    `${NOMINATIM}search?format=jsonv2&accept-language=th&countrycodes=th&limit=6&q=${encodeURIComponent(q)}`),
};

// ---------------------------------------------------------------- ชั้นข้อมูล
const BASES = [
  { id: "truecolor", name: "ภาพถ่ายสีจริง (รายวัน)", desc: "VIIRS NOAA-20 · เห็นเมฆ ควัน และตะกอนในน้ำ",
    gibs: "VIIRS_NOAA20_CorrectedReflectance_TrueColor", level: 9, ext: "jpeg", daily: true },
  { id: "falsecolor", name: "ภาพสีผสมเน้นน้ำ (รายวัน)", desc: "น้ำ = น้ำเงินเข้ม/ดำ · พืช = เขียวสด · ดินแห้ง = น้ำตาล",
    gibs: "VIIRS_NOAA20_CorrectedReflectance_BandsM11-I2-I1", level: 9, ext: "jpeg", daily: true },
  { id: "modis721", name: "ภาพสีผสม MODIS 7-2-1 (รายวัน)", desc: "น้ำท่วมเป็นสีน้ำเงินเข้ม แยกจากเมฆ (สีฟ้าอ่อน) ได้ชัด",
    gibs: "MODIS_Terra_CorrectedReflectance_Bands721", level: 9, ext: "jpeg", daily: true },
  { id: "esri", name: "ภาพดาวเทียมความละเอียดสูง", desc: "Esri World Imagery · ไม่ใช่ภาพปัจจุบัน ใช้ดูรายละเอียดพื้นที่",
    url: ESRI + "World_Imagery/MapServer/tile/{z}/{y}/{x}", maxzoom: 19, attribution: "Imagery © Esri, Maxar" },
  { id: "dark", name: "แผนที่โทนมืด", desc: "Esri Dark Gray · เหมาะกับดูชั้นข้อมูลสี",
    url: ESRI + "Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", maxzoom: 16, attribution: "© Esri" },
  { id: "osm", name: "แผนที่ถนน", desc: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxzoom: 19, attribution: "© OpenStreetMap contributors" },
];

const OVERLAYS = [
  { id: "modis_flood", group: "flood", name: "พื้นที่น้ำท่วม MODIS (2 วัน)",
    desc: "รวมภาพ 2 วันเพื่อลดผลจากเมฆบัง", gibs: "MODIS_Combined_Flood_2-Day", level: 9,
    about: "ดาวเทียม Terra และ Aqua (เครื่องวัด MODIS) ถ่ายวันละ 2 รอบ ความละเอียดราว 250 ม. ระบบตรวจหาน้ำจากค่าการสะท้อนแสง แล้วเทียบกับแผนที่แหล่งน้ำถาวรและประวัติน้ำท่วมในอดีต เพื่อแยกว่าเป็นน้ำปกติ น้ำท่วมตามฤดูกาล หรือน้ำท่วมผิดปกติ · รวมภาพ 2 วันเพื่อกรองเงาเมฆที่อาจถูกเข้าใจผิดว่าเป็นน้ำ · ข้อจำกัด: มองทะลุเมฆไม่ได้ มองไม่เห็นน้ำใต้ต้นไม้หรือในเมืองที่มีอาคารหนาแน่น และเงาภูเขาอาจถูกจัดเป็นน้ำ · ใช้คู่กับชั้นเรดาร์ 30 ม. เพื่อยืนยันผล",
    colormap: "MODIS_Flood", legend: "classes", hide: ["175,175,175", "50,210,245"], daily: true, opacity: 0.85, emptyLabel: "ไม่พบน้ำ" },
  { id: "viirs_flood", group: "flood", name: "พื้นที่น้ำท่วม VIIRS (2 วัน)",
    desc: "ดาวเทียมอีกชุด ใช้ยืนยันผลกับ MODIS", gibs: "VIIRS_Combined_Flood_2-Day", level: 9,
    about: "ดาวเทียม NOAA-20 และ NOAA-21 (เครื่องวัด VIIRS) ความละเอียดราว 375 ม. ใช้วิธีจัดประเภทแบบเดียวกับ MODIS · เป็นดาวเทียมรุ่นใหม่ที่จะมาแทน MODIS ซึ่งใกล้หมดอายุ · ถ้าทั้ง MODIS และ VIIRS แสดงสีแดงตรงกัน ผลจะน่าเชื่อถือมากขึ้น",
    colormap: "MODIS_Flood", legend: "classes", hide: ["175,175,175", "50,210,245"], daily: true, opacity: 0.85, emptyLabel: "ไม่พบน้ำ" },
  { id: "opera", group: "flood", name: "ผิวน้ำละเอียด 30 ม. (เรดาร์ Sentinel-1)",
    desc: "มองทะลุเมฆได้ แต่ไม่ได้ถ่ายทุกวัน · ซูมเข้าเพื่อดูรายละเอียด",
    gibs: "OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1", level: 12,
    about: "เรดาร์ SAR บนดาวเทียม Sentinel-1 ส่งคลื่นไมโครเวฟลงมาและวัดการสะท้อนกลับ ผิวน้ำเรียบสะท้อนคลื่นออกไปทางอื่นจึงดูมืด ทำให้แยกน้ำออกได้ทั้งกลางวันกลางคืนและผ่านเมฆ ความละเอียด 30 ม. · ข้อจำกัด: ถ่ายพื้นที่เดิมทุก 6–12 วัน และไม่แยกน้ำท่วมออกจากแหล่งน้ำปกติ",
    colormap: "OPERA_Dynamic_Surface_Water_Extent_S1", legend: "classes", daily: true, opacity: 0.9,
    hide: ["255,255,255", "200,200,200", "128,128,128"],
    emptyLabel: "ไม่มีภาพเรดาร์วันนี้" },
  { id: "eonet", group: "flood", type: "eonet", name: "เหตุการณ์น้ำท่วม (EONET)",
    desc: "120 วันล่าสุดในภูมิภาค · จุดใหญ่ = เกิดภายใน 7 วันจากวันที่เลือก" },

  { id: "aod", group: "pm", name: "ความหนาฝุ่นละออง AOD (MODIS)",
    desc: "ยิ่งสูงยิ่งมีฝุ่น/ควันมาก · มากกว่า 0.5 ถือว่าสูง",
    gibs: "MODIS_Combined_Value_Added_AOD", level: 6, colormap: "MODIS_Combined_Value_Added_AOD",
    daily: true, opacity: 0.7, emptyLabel: "ไม่มีข้อมูล (เมฆบัง)" },
  { id: "aod_viirs", group: "pm", name: "ความหนาฝุ่นละออง AOD (VIIRS)",
    desc: "VIIRS Deep Blue · ครอบคลุมพื้นที่สว่าง เช่น เมือง ได้ดีกว่า",
    gibs: "VIIRS_NOAA20_AOD_Deep_Blue_Land_Ocean", level: 6, colormap: "MODIS_VIIRS_AOD",
    daily: true, opacity: 0.7, emptyLabel: "ไม่มีข้อมูล (เมฆบัง)" },
  { id: "fires", group: "pm", type: "wms", name: "จุดความร้อน / ไฟป่า (VIIRS)",
    desc: "แหล่งกำเนิดควันและฝุ่น", gibs: "VIIRS_NOAA20_Thermal_Anomalies_375m_All",
    daily: true, opacity: 1, swatches: [["#f02828", "จุดความร้อนที่ตรวจพบ"]] },
  { id: "air4thai", group: "pm", type: "air4thai", name: "PM2.5 สถานีภาคพื้นดิน (Air4Thai)",
    desc: "ค่าล่าสุดรายชั่วโมงจากกรมควบคุมมลพิษ · ไม่เปลี่ยนตามวันที่ที่เลือก" },

  { id: "imerg", group: "rain", name: "ฝนรายวัน (IMERG)",
    desc: "อัตราฝนเฉลี่ยจากดาวเทียม GPM", gibs: "IMERG_Precipitation_Rate", level: 6,
    colormap: "GPM_Precipitation_Rate", daily: true, opacity: 0.75, emptyLabel: "ไม่มีฝน (< 0.1 mm/ชม.)" },
  { id: "imerg30", group: "rain", name: "ฝนราย 30 นาที (IMERG)",
    desc: "เลือกช่วงเวลาได้ (เวลาไทย)", gibs: "IMERG_Precipitation_Rate_30min", level: 6,
    colormap: "GPM_Precipitation_Rate", halfHourly: true, opacity: 0.75, emptyLabel: "ไม่มีฝน" },
  { id: "himawari", group: "rain", name: "เมฆอินฟราเรด Himawari (สด)",
    desc: "ภาพล่าสุด อัปเดตทุก 10 นาที · เมฆยอดเย็นจัด = พายุฝนฟ้าคะนอง · ไม่เปลี่ยนตามวันที่",
    gibs: "Himawari_AHI_Band13_Clean_Infrared", level: 6, colormap: "Clean_Longwave_Infrared_Window_Band",
    latestOnly: true, opacity: 0.6 },
  { id: "smap", group: "rain", name: "ความชื้นในดิน (SMAP)",
    desc: "ดินอิ่มน้ำ = ฝนที่ตกเพิ่มจะกลายเป็นน้ำหลากได้ง่าย",
    gibs: "SMAP_L4_Analyzed_Surface_Soil_Moisture", level: 6, colormap: "SMAP_Analyzed_Soil_Moisture",
    daily: true, opacity: 0.7, emptyLabel: "ไม่มีข้อมูล" },

  { id: "labels", group: "ref", type: "static", name: "ชื่อสถานที่และเขตแดน",
    url: ESRI + "Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", maxzoom: 19,
    attribution: "Labels © Esri", opacity: 1 },
];

const GROUPS = { flood: "🌊 น้ำท่วม", pm: "💨 ฝุ่น PM", rain: "🌧️ ฝนและความชื้น", ref: "อ้างอิง" };
const MODES = {
  flood: { base: "truecolor", on: ["modis_flood", "eonet", "labels"] },
  pm: { base: "truecolor", on: ["aod", "fires", "air4thai", "labels"] },
  rain: { base: "dark", on: ["imerg", "labels"] },
};

const TH = {
  "No Water": "ไม่มีน้ำ", "Surface Water": "แหล่งน้ำปกติ", "Recurring Flood": "น้ำท่วมตามฤดูกาล (ซ้ำซาก)",
  "Flood": "น้ำท่วม", "Insufficient Data": "ข้อมูลไม่พอ (เมฆบัง)", "Not Water": "ไม่ใช่น้ำ",
  "Open Water": "ผิวน้ำ", "Inundated Vegetation": "พืชจมน้ำ",
  "Height Above Nearest Drainage (HAND) masked": "ตัดออก (พื้นที่สูง)",
  "Layover/shadow masked": "ตัดออก (เงาภูเขา)", "Fill value (no data)": "ไม่มีข้อมูล",
  "No Data": "ไม่มีข้อมูล", "Fill": "ไม่มีข้อมูล", "Insignificant": "ฝนน้อยมาก",
};
// ความหมายของแต่ละประเภทในชั้นน้ำท่วม (แสดงในคำอธิบายสีและแผงรายละเอียด)
const CLASS_INFO = {
  "Flood": "ตรวจพบน้ำในพื้นที่ที่ปกติไม่ใช่แหล่งน้ำ และไม่ใช่บริเวณที่ท่วมเป็นประจำ = น้ำท่วมผิดปกติ ควรเฝ้าระวังและตรวจสอบต่อ",
  "Recurring Flood": "ตรวจพบน้ำในพื้นที่ที่มีประวัติน้ำขังเป็นประจำตามฤดูกาล เช่น ทุ่งนา ที่ราบลุ่มแม่น้ำ ทุ่งรับน้ำ · มีน้ำจริงแต่เป็นภาวะปกติของฤดู",
  "Surface Water": "แหล่งน้ำถาวรตามแผนที่อ้างอิง เช่น แม่น้ำ อ่างเก็บน้ำ ทะเลสาบ ทะเล",
  "Insufficient Data": "เมฆหรือเงาเมฆบังตลอดช่วงเวลาที่รวมภาพ ดาวเทียมจึงมองไม่เห็นพื้นดิน · ไม่ได้แปลว่าไม่ท่วม",
  "Open Water": "ผิวน้ำที่เรดาร์ตรวจพบ ทั้งแหล่งน้ำปกติและน้ำท่วม (ไม่ได้แยกสองแบบนี้ออกจากกัน)",
  "Not Water": "เรดาร์ไม่พบน้ำ",
  "Height Above Nearest Drainage (HAND) masked": "พื้นที่สูงกว่าทางน้ำมาก โอกาสน้ำขังต่ำ จึงตัดออกเพื่อลดผลผิดพลาด",
  "Layover/shadow masked": "พื้นที่ลาดชันที่เรดาร์มองไม่เห็น (เงาภูเขา) จึงตัดออก",
};

const UNITS_TH = { "mm/hr": "mm/ชม.", "m³/m³": "m³/m³", "°C": "°C" };

// ระดับ PM2.5 ตามเกณฑ์ประเทศไทย (µg/m³)
const PM_LEVELS = [
  [15, "#3bccff", "ดีมาก"], [25, "#92d050", "ดี"], [37.5, "#f5d90a", "ปานกลาง"],
  [75, "#ffa200", "เริ่มมีผลกระทบต่อสุขภาพ"], [Infinity, "#f04646", "มีผลกระทบต่อสุขภาพ"],
];
const pmLevel = v => PM_LEVELS.find(([max]) => v <= max);
const aodLevel = v => v < 0.1 ? "อากาศสะอาด" : v < 0.3 ? "ปานกลาง" : v < 0.5 ? "มีหมอกควัน"
  : v < 1 ? "ฝุ่น/ควันสูง" : "ฝุ่น/ควันหนาแน่นมาก";
const rainLevel = v => v < 0.1 ? "ไม่มีฝน" : v < 2.5 ? "ฝนเล็กน้อย" : v < 7.6 ? "ฝนปานกลาง"
  : v < 50 ? "ฝนหนัก" : "ฝนหนักมาก";
const soilLevel = v => v < 0.15 ? "ดินแห้ง" : v < 0.3 ? "ชื้นปานกลาง" : v < 0.4 ? "ชื้นมาก" : "ดินอิ่มน้ำ";

// ---------------------------------------------------------------- สถานะ
const state = {
  base: "truecolor",
  on: new Set(),
  opacity: Object.fromEntries(OVERLAYS.map(o => [o.id, o.opacity ?? 0.8])),
  date: null,
  slot: "06:00",        // ช่วงเวลา UTC ของฝนราย 30 นาที
  latest: {},           // วันที่ล่าสุดของแต่ละชั้น GIBS จาก /api/gibs-latest
  mode: null,
  inspected: null,
};

const $ = id => document.getElementById(id);
const fmtDate = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return fmtDate(d); };
const todayUTC = () => fmtDate(new Date());
const fmtThaiDate = s => new Date(s + "T00:00:00Z").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
// ค่าเริ่มต้น = เมื่อวาน (UTC) เพราะภาพของวันนี้อาจยังถ่ายไม่ครบ
state.date = addDays(todayUTC(), -1);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg, ms = 3500) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

// วันที่ที่ใช้จริงของชั้นข้อมูล: ถ้าเลือกวันที่ใหม่กว่าข้อมูลล่าสุดที่มี ให้ใช้วันล่าสุดแทน
function effectiveDate(layer, date = state.date) {
  const end = state.latest[layer.gibs]?.end?.slice(0, 10);
  return end && date > end ? end : date;
}

function slotTime(layer) {
  let t = `${state.date}T${state.slot}:00Z`;
  const end = state.latest[layer.gibs]?.end;
  if (end && t > end) t = end;
  return t;
}

function tileUrl(layer, date = state.date) {
  if (layer.url) return layer.url;
  if (layer.type === "wms") {
    return `${WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${layer.gibs}&STYLES=&CRS=EPSG:3857` +
      `&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true&TIME=${effectiveDate(layer, date)}`;
  }
  let time = "";
  if (layer.daily) time = effectiveDate(layer, date) + "/";
  if (layer.halfHourly) time = slotTime(layer) + "/";
  const url = `${WMTS}${layer.gibs}/default/${time}GoogleMapsCompatible_Level${layer.level}/{z}/{y}/{x}.${layer.ext || "png"}`;
  // ภาพ Himawari ไม่ระบุเวลา = ภาพล่าสุด ใส่ตัวแปรกัน cache ให้เปลี่ยนทุก 10 นาที
  return layer.latestOnly ? `${url}?t=${Math.floor(Date.now() / 6e5)}` : url;
}

// ---------------------------------------------------------------- กรองประเภทข้อมูลบนภาพ
// ชั้นแบบแบ่งประเภท (น้ำท่วม/ผิวน้ำ) โหลดผ่าน protocol "gibsmask://" เพื่อลบสีของประเภทที่ผู้ใช้ซ่อน
// เช่น "ข้อมูลไม่พอ (เมฆบัง)" ซึ่งเป็นสีเทาทึบที่บังภาพพื้นหลังเกือบทั้งหมดในหน้าฝน
state.hidden = Object.fromEntries(OVERLAYS.filter(o => o.hide).map(o => [o.id, new Set(o.hide)]));

function mapUrl(layer) {
  const raw = tileUrl(layer);
  if (layer.legend !== "classes") return raw;
  const hidden = [...(state.hidden[layer.id] || [])].sort().join(";");
  return `gibsmask://${layer.id}/${raw.replace(/^https:\/\//, "")}#${hidden}`;
}

maplibregl.addProtocol("gibsmask", async params => {
  const [path, hiddenKey = ""] = params.url.slice("gibsmask://".length).split("#");
  const slash = path.indexOf("/");
  const res = await fetch("https://" + path.slice(slash + 1));
  if (!res.ok) throw new Error("HTTP " + res.status);
  const blob = await res.blob();
  const hidden = new Set(hiddenKey ? hiddenKey.split(";") : []);
  if (!hidden.size) return { data: await blob.arrayBuffer() };
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] && hidden.has(`${px[i]},${px[i + 1]},${px[i + 2]}`)) px[i + 3] = 0;
  }
  ctx.putImageData(img, 0, 0);
  return { data: await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer() };
});

// ---------------------------------------------------------------- แผนที่
function rasterSource(layer) {
  return {
    type: "raster", tileSize: 256, tiles: [mapUrl(layer)],
    maxzoom: layer.maxzoom ?? layer.level ?? 9,
    attribution: layer.attribution ?? "NASA GIBS",
  };
}

const sources = {}, layers = [];
BASES.forEach(b => {
  sources["base-" + b.id] = rasterSource(b);
  layers.push({ id: "base-" + b.id, type: "raster", source: "base-" + b.id, layout: { visibility: "none" } });
});
OVERLAYS.filter(o => !o.type || o.type === "wms" || o.type === "static").forEach(o => {
  sources["ov-" + o.id] = rasterSource(o);
  layers.push({ id: "ov-" + o.id, type: "raster", source: "ov-" + o.id,
                layout: { visibility: "none" }, paint: { "raster-opacity": state.opacity[o.id] } });
});
sources.eonet = { type: "geojson", data: { type: "FeatureCollection", features: [] }, attribution: "NASA EONET / GDACS" };
layers.push(
  { id: "eonet-glow", type: "circle", source: "eonet", layout: { visibility: "none" }, paint: {
      "circle-color": "#ff3b30", "circle-blur": 0.7,
      "circle-radius": ["case", ["get", "recent"], 20, 10],
      "circle-opacity": ["case", ["get", "recent"], 0.45, 0.2] } },
  { id: "eonet-pt", type: "circle", source: "eonet", layout: { visibility: "none" }, paint: {
      "circle-color": ["case", ["get", "recent"], "#ff3b30", "#ff9f94"],
      "circle-radius": ["case", ["get", "recent"], 7, 4],
      "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } },
);

const map = new maplibregl.Map({
  container: "map",
  style: { version: 8, sources, layers },
  bounds: THAILAND,
  fitBoundsOptions: { padding: framePadding() },
  maxZoom: 14,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

function framePadding() {
  if (innerWidth <= 860) return 20;
  return { left: 360, right: $("detail")?.hidden === false ? 410 : 40, top: 30, bottom: 30 };
}

let ready = false;
const whenReady = fn => (...a) => ready ? fn(...a) : map.once("load", () => fn(...a));

// ---------------------------------------------------------------- แถบด้านข้าง
function buildSidebar() {
  $("base-list").innerHTML = BASES.map(b => `
    <div class="layer" data-id="${b.id}">
      <label><input type="radio" name="base" value="${b.id}">
        <span><span class="name">${b.name}</span><div class="desc">${b.desc}</div>
        <div class="status" data-status="${b.id}"></div></span>
      </label>
    </div>`).join("");

  let html = "", group = null;
  for (const o of OVERLAYS) {
    if (o.group !== group) { group = o.group; html += `<div class="group-title">${GROUPS[group]}</div>`; }
    const raster = !o.type || o.type === "wms" || o.type === "static";
    html += `
      <div class="layer" data-id="${o.id}">
        <label><input type="checkbox" value="${o.id}">
          <span><span class="name">${o.name}</span><div class="desc">${o.desc || ""}</div>
          <div class="status" data-status="${o.id}"></div></span>
        </label>
        <div class="controls">
          ${o.halfHourly ? `<select class="time-select" data-slot aria-label="เวลา">${slotOptions()}</select>` : ""}
          ${raster ? `<input type="range" min="0" max="1" step="0.05" value="${state.opacity[o.id]}" aria-label="ความทึบ" data-opacity="${o.id}">` : ""}
          <div data-legend="${o.id}"></div>
        </div>
      </div>`;
  }
  $("overlay-list").innerHTML = html;

  document.querySelectorAll("input[name=base]").forEach(r => r.onchange = whenReady(() => setBase(r.value)));
  document.querySelectorAll("#overlay-list input[type=checkbox]").forEach(cb =>
    cb.onchange = whenReady(() => toggleOverlay(cb.value, cb.checked)));
  document.querySelectorAll("[data-opacity]").forEach(sl => sl.oninput = whenReady(() => {
    state.opacity[sl.dataset.opacity] = +sl.value;
    map.setPaintProperty("ov-" + sl.dataset.opacity, "raster-opacity", +sl.value);
  }));
  const slot = document.querySelector("[data-slot]");
  slot.value = state.slot;
  slot.onchange = whenReady(() => { state.slot = slot.value; refreshTiles(); });
}

function slotOptions() {
  const opts = [];
  for (let m = 0; m < 1440; m += 30) {
    const utc = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const th = (m + 420) % 1440;
    const thTxt = `${String(Math.floor(th / 60)).padStart(2, "0")}:${String(th % 60).padStart(2, "0")}`;
    opts.push(`<option value="${utc}">${thTxt} น. (เวลาไทย${m + 420 >= 1440 ? " วันถัดไป" : ""})</option>`);
  }
  return opts.join("");
}

function setBase(id) {
  state.base = id;
  BASES.forEach(b => map.setLayoutProperty("base-" + b.id, "visibility", b.id === id ? "visible" : "none"));
  document.querySelectorAll("input[name=base]").forEach(r => (r.checked = r.value === id));
  updateStatuses();
}

function toggleOverlay(id, on) {
  const o = OVERLAYS.find(x => x.id === id);
  on ? state.on.add(id) : state.on.delete(id);
  const vis = on ? "visible" : "none";
  if (o.type === "eonet") {
    map.setLayoutProperty("eonet-glow", "visibility", vis);
    map.setLayoutProperty("eonet-pt", "visibility", vis);
    if (on) loadEonet();
  } else if (o.type === "air4thai") {
    on ? showStations() : stationMarkers.forEach(m => m.remove());
  } else {
    map.setLayoutProperty("ov-" + id, "visibility", vis);
  }
  const row = document.querySelector(`.layer[data-id="${id}"]`);
  row.classList.toggle("active", on);
  row.querySelector("input[type=checkbox]").checked = on;
  if (on) renderLegend(o);
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll("#modes button").forEach(b => b.setAttribute("aria-selected", b.dataset.mode === mode));
  const preset = MODES[mode];
  setBase(preset.base);
  OVERLAYS.forEach(o => toggleOverlay(o.id, preset.on.includes(o.id)));
  if (state.inspected) inspect(state.inspected);
}

// ---------------------------------------------------------------- คำอธิบายสัญลักษณ์
async function renderLegend(o) {
  const el = document.querySelector(`[data-legend="${o.id}"]`);
  if (!el || el.dataset.done) return;
  el.dataset.done = 1;
  if (o.swatches) {
    el.innerHTML = `<div class="legend-swatches">${o.swatches.map(([c, t]) => `<span style="--c:${c}">${t}</span>`).join("")}</div>`;
  } else if (o.type === "eonet") {
    el.innerHTML = `<div class="legend-swatches"><span style="--c:#ff3b30">ภายใน 7 วัน</span><span style="--c:#ff9f94">ก่อนหน้านั้น</span></div>`;
  } else if (o.type === "air4thai") {
    el.innerHTML = `<div class="legend-swatches">${PM_LEVELS.map(([max, c, t]) => `<span style="--c:${c}">${t}</span>`).join("")}</div>`;
  } else if (o.legend === "classes") {
    // แต่ละประเภทกดเปิด/ปิดได้ (เฉพาะประเภทที่มีสีจริงบนภาพ)
    const cm = await loadColormap(o.colormap);
    const visible = cm.legend.filter(e => {
      const entry = cm.byRgb.get(e.rgb);
      return entry && !entry.transparent && !entry.nodata;
    });
    el.innerHTML = `<div class="legend-swatches toggles">${visible.map(e =>
      `<button type="button" data-rgb="${e.rgb}" style="--c:rgb(${e.rgb})" aria-pressed="${!state.hidden[o.id]?.has(e.rgb)}">` +
      `${TH[e.label] || e.label}</button>`).join("")}</div>
      <div class="hint muted">กดที่ประเภทเพื่อซ่อน/แสดง</div>
      <details class="class-info">
        <summary>ความหมายของแต่ละสี</summary>
        <dl>${visible.filter(e => CLASS_INFO[e.label]).map(e =>
          `<dt><span class="dot" style="background:rgb(${e.rgb})"></span>${TH[e.label] || e.label}</dt>` +
          `<dd>${CLASS_INFO[e.label]}</dd>`).join("")}</dl>
        ${o.about ? `<p class="about">${o.about}</p>` : ""}
      </details>`;
    el.querySelectorAll("button").forEach(b => b.onclick = () => {
      const set = (state.hidden[o.id] ??= new Set());
      set.has(b.dataset.rgb) ? set.delete(b.dataset.rgb) : set.add(b.dataset.rgb);
      b.setAttribute("aria-pressed", !set.has(b.dataset.rgb));
      map.getSource("ov-" + o.id).setTiles([mapUrl(o)]);
    });
  } else if (o.colormap) {
    el.innerHTML = `<img class="legend-img" alt="คำอธิบายสี ${esc(o.name)}" src="${GIBS}legends/${o.colormap}_H.svg">`;
  }
}

// ---------------------------------------------------------------- วันที่
function setDate(date, { quiet } = {}) {
  const max = todayUTC();
  state.date = date > max ? max : date;
  $("date").value = state.date;
  refreshTiles();
  if (state.on.has("eonet")) markRecentEonet();
  if (!quiet && state.inspected) inspect(state.inspected);
}

function refreshTiles() {
  [...BASES, ...OVERLAYS].forEach(l => {
    if (!(l.daily || l.halfHourly || l.latestOnly)) return;
    const src = map.getSource((BASES.includes(l) ? "base-" : "ov-") + l.id);
    src?.setTiles([mapUrl(l)]);
  });
  updateStatuses();
}

function updateStatuses() {
  [...BASES, ...OVERLAYS].forEach(l => {
    const el = document.querySelector(`[data-status="${l.id}"]`);
    if (!el || l.type === "air4thai") return;
    let msg = "";
    if (l.daily && l.gibs) {
      const eff = effectiveDate(l);
      if (eff !== state.date) msg = `ใช้ข้อมูลวันที่ ${fmtThaiDate(eff)} (ล่าสุดที่มี)`;
    } else if (l.halfHourly) {
      const t = slotTime(l);
      if (!t.startsWith(`${state.date}T${state.slot}`)) msg = `ข้อมูลล่าสุดถึง ${t.slice(0, 16).replace("T", " ")} UTC`;
    } else if (l.latestOnly && state.latest[l.gibs]) {
      const t = new Date(state.latest[l.gibs].default);
      msg = `ภาพเวลา ${t.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.`;
    }
    el.textContent = msg;
    el.style.color = l.latestOnly ? "var(--muted)" : "";
  });
}

let playing = null;
function togglePlay() {
  if (playing) return stopPlay();
  const days = +$("play-days").value;
  const end = state.date;
  let d = addDays(end, -(days - 1));
  $("play").textContent = "■ หยุด";
  $("play").classList.add("on");
  const step = () => {
    setDate(d, { quiet: true });
    if (d >= end) return stopPlay(true);
    d = addDays(d, 1);
    playing = setTimeout(step, 1400);
  };
  step();
}
function stopPlay(finished) {
  clearTimeout(playing);
  playing = null;
  $("play").textContent = "▶ เล่นย้อนหลัง";
  $("play").classList.remove("on");
  if (finished && state.inspected) inspect(state.inspected);
}

// ---------------------------------------------------------------- EONET
let eonetData = null;
async function loadEonet() {
  if (eonetData) return markRecentEonet();
  try {
    const r = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?category=floods&status=all&days=120&bbox=92,28,110,0");
    const { events } = await r.json();
    eonetData = events.map(e => {
      const g = e.geometry[0];
      let [lon, lat] = g.type === "Point" ? g.coordinates : centroid(g.coordinates[0]);
      // polygon จาก GDACS บางชุดเรียงเป็น [lat, lon] (กลับด้านจาก GeoJSON)
      if (lon < 90 && lat > 90) [lon, lat] = [lat, lon];
      return { type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] },
        properties: { title: e.title, date: g.date.slice(0, 10), closed: e.closed?.slice(0, 10) || "", source: e.sources[0]?.url || "" } };
    });
    markRecentEonet();
  } catch (err) {
    toast("โหลดข้อมูล EONET ไม่สำเร็จ: " + err.message);
  }
}
const centroid = ring => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];

function markRecentEonet() {
  if (!eonetData) return;
  const lo = addDays(state.date, -7), hi = addDays(state.date, 7);
  map.getSource("eonet").setData({ type: "FeatureCollection", features: eonetData.map(f => ({
    ...f, properties: { ...f.properties, recent: f.properties.date >= lo && f.properties.date <= hi } })) });
}

map.on("click", "eonet-pt", ev => {
  ev.preventDefault();
  const p = ev.features[0].properties;
  new maplibregl.Popup({ offset: 8 }).setLngLat(ev.features[0].geometry.coordinates).setHTML(
    `<b>${esc(p.title)}</b><br>เริ่ม ${fmtThaiDate(p.date)}${p.closed ? ` · ปิด ${fmtThaiDate(p.closed)}` : " · <b style='color:#ff6b61'>ยังเกิดอยู่</b>"}` +
    `<br><button class="btn" style="margin-top:6px" data-goto="${p.date}">ดูภาพดาวเทียมวันนั้น</button>` +
    (p.source ? ` <a href="${esc(p.source)}" target="_blank" rel="noopener">รายงาน GDACS</a>` : "")
  ).addTo(map).getElement().querySelector("[data-goto]").onclick = e => setDate(e.target.dataset.goto);
});
map.on("mouseenter", "eonet-pt", () => (map.getCanvas().style.cursor = "pointer"));
map.on("mouseleave", "eonet-pt", () => (map.getCanvas().style.cursor = ""));

// ---------------------------------------------------------------- Air4Thai
let stations = null, stationsUpdated = "";
const stationMarkers = [];
async function loadStations() {
  if (stations) return stations;
  const d = await api.air4thai();
  stationsUpdated = d.updated;
  stations = d.stations.filter(s => s.pm25 != null);
  return stations;
}

async function showStations() {
  try {
    await loadStations();
  } catch (err) {
    toast("โหลดข้อมูล Air4Thai ไม่สำเร็จ: " + err.message, 6000);
    return;
  }
  if (!state.on.has("air4thai")) return;
  stationMarkers.forEach(m => m.remove());
  stationMarkers.length = 0;
  for (const s of stations) {
    const [, color, label] = pmLevel(s.pm25);
    const el = document.createElement("div");
    el.className = "pm-marker";
    el.style.cssText = `background:${color};color:#111;font:600 11px/1 system-ui;padding:4px 5px;border-radius:10px;` +
      `border:1.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);cursor:pointer;min-width:22px;text-align:center`;
    el.textContent = Math.round(s.pm25);
    el.title = `${s.name}: PM2.5 ${s.pm25} µg/m³`;
    const popup = new maplibregl.Popup({ offset: 14 }).setHTML(
      `<b>${esc(s.name)}</b><br><span class="muted">${esc(s.area)}</span><br>` +
      `PM2.5 <b>${s.pm25}</b> µg/m³ · <span style="color:${color}">${label}</span><br>` +
      `<span class="muted">อัปเดต ${esc(s.date)} ${esc(s.time)} น.</span>`);
    stationMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).setPopup(popup).addTo(map));
    el.addEventListener("click", e => e.stopPropagation());
  }
  for (const [i, s] of stations.entries()) {
    if (s.date < addDays(todayUTC(), -2)) stationMarkers[i].getElement().style.opacity = 0.4;
  }
  const st = document.querySelector('[data-status="air4thai"]');
  if (st) { st.textContent = `${stations.length} สถานี · ดึงข้อมูลเมื่อ ${stationsUpdated}`; st.style.color = "var(--muted)"; }
}

// ---------------------------------------------------------------- อ่านค่าจากพิกเซล
// ภาพ GIBS เป็น PNG ที่ระบายสีตาม colormap จึงแปลงสีของพิกเซลกลับเป็นค่าจริงได้
const colormaps = {};
function loadColormap(name) {
  colormaps[name] ??= fetch(`${GIBS}colormaps/v1.3/${name}.xml`).then(r => r.text()).then(parseColormap);
  return colormaps[name];
}

function parseColormap(xml) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const entries = [], legend = [];
  doc.querySelectorAll("ColorMap").forEach(cm => {
    const units = cm.getAttribute("units") || "";
    const tips = {};
    cm.querySelectorAll("LegendEntry").forEach(le => {
      tips[le.getAttribute("id")] = le.getAttribute("tooltip");
      legend.push({ rgb: le.getAttribute("rgb"), label: le.getAttribute("tooltip") });
    });
    cm.querySelectorAll("ColorMapEntry").forEach(e => entries.push({
      rgb: e.getAttribute("rgb").split(",").map(Number),
      nodata: e.getAttribute("nodata") === "true",
      transparent: e.getAttribute("transparent") === "true",
      value: e.getAttribute("value") || e.getAttribute("sourceValue") || "",
      label: tips[e.getAttribute("ref")] || "",
      units,
    }));
  });
  const byRgb = new Map();
  for (const e of entries) {
    const k = e.rgb.join(",");
    if (!byRgb.has(k) || byRgb.get(k).nodata) byRgb.set(k, e);
  }
  return { entries, byRgb, legend };
}

function entryNumber(e) {
  const nums = (e.value.match(/-?\d+(\.\d+)?/g) || []).map(Number);
  if (!nums.length) return null;
  return nums.length === 1 ? nums[0] : (nums[0] + nums[1]) / 2;
}

const tileCache = new Map();
// ลองใหม่ 1 ครั้งเมื่อเครือข่ายล้มเหลว (ไม่ลองใหม่เมื่อ 404 = ไม่มีภาพจริง)
async function fetchRetry(url) {
  try {
    const r = await fetch(url);
    if (r.ok || r.status === 404) return r;
  } catch { /* ลองใหม่ด้านล่าง */ }
  await new Promise(res => setTimeout(res, 800));
  return fetch(url);
}

function getTile(url) {
  if (!tileCache.has(url)) {
    tileCache.set(url, fetchRetry(url)
      .then(r => { if (!r.ok) throw Object.assign(new Error("HTTP " + r.status), { status: r.status }); return r.blob(); })
      .then(b => createImageBitmap(b, { premultiplyAlpha: "none", colorSpaceConversion: "none" }))
      .then(bmp => {
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, bmp.width, bmp.height);
      })
      .catch(err => { tileCache.delete(url); throw err; }));
    if (tileCache.size > 400) tileCache.delete(tileCache.keys().next().value);
  }
  return tileCache.get(url);
}

async function samplePixel(layer, date, [lng, lat]) {
  const z = layer.level;
  const n = 2 ** z;
  const xf = (lng + 180) / 360 * n;
  const yf = (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n;
  const x = Math.floor(xf), y = Math.floor(yf);
  const url = tileUrl(layer, date).replace("{z}", z).replace("{x}", x).replace("{y}", y);
  const img = await getTile(url);
  const px = Math.min(img.width - 1, Math.floor((xf - x) * img.width));
  const py = Math.min(img.height - 1, Math.floor((yf - y) * img.height));
  const i = (py * img.width + px) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

async function readValue(layer, lngLat, date = state.date) {
  const eff = layer.daily ? effectiveDate(layer, date) : date;
  let rgba;
  try {
    rgba = await samplePixel(layer, eff, lngLat);
  } catch (err) {
    if (err.status === 404) return { date: eff, empty: true, text: layer.emptyLabel || "ไม่มีข้อมูล" };
    return { date: eff, empty: true, failed: true, text: "โหลดไม่สำเร็จ ลองคลิกใหม่" };
  }
  const cm = await loadColormap(layer.colormap);
  if (rgba[3] < 10) return { date: eff, empty: true, text: layer.emptyLabel || "ไม่มีข้อมูล" };
  let e = cm.byRgb.get(rgba.slice(0, 3).join(","));
  if (!e) {
    let best = 1e9;
    for (const c of cm.entries) {
      const d = (c.rgb[0] - rgba[0]) ** 2 + (c.rgb[1] - rgba[1]) ** 2 + (c.rgb[2] - rgba[2]) ** 2;
      if (d < best) { best = d; e = c; }
    }
    if (best > 300) e = null;
  }
  if (!e || e.nodata) return { date: eff, empty: true, text: layer.emptyLabel || "ไม่มีข้อมูล" };
  const units = UNITS_TH[e.units] ?? e.units;
  const num = layer.legend === "classes" ? null : entryNumber(e);
  const text = layer.legend === "classes" ? (TH[e.label] || e.label) : `${e.label || num}${units ? " " + units : ""}`;
  return { date: eff, text, num, label: e.label, rgb: e.rgb };
}

// ---------------------------------------------------------------- รายละเอียดพื้นที่
let pin = null, inspectSeq = 0;

function distanceKm([lon1, lat1], [lon2, lat2]) {
  const R = 6371, toR = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * toR / 2) ** 2 +
    Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin((lon2 - lon1) * toR / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const L = id => OVERLAYS.find(o => o.id === id);

function metric(icon, label, value, note = "", dot = "") {
  return `<div class="metric"><span class="label">${icon} ${label}</span>
    <span class="value">${dot ? `<span class="dot" style="background:${dot}"></span>` : ""}${value}</span>
    ${note ? `<span class="note">${note}</span>` : ""}</div>`;
}

async function inspect(lngLat) {
  const seq = ++inspectSeq;
  state.inspected = lngLat;
  const [lng, lat] = lngLat;
  pin ??= new maplibregl.Marker({ color: "#3d8bff" });
  pin.setLngLat(lngLat).addTo(map);
  const panel = $("detail");
  const wasHidden = panel.hidden;
  panel.hidden = false;
  $("detail-title").textContent = "รายละเอียดพื้นที่";
  $("detail-sub").textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)} · ข้อมูลวันที่ ${fmtThaiDate(state.date)}`;
  $("detail-body").innerHTML = `<p class="loading">กำลังอ่านค่าจากภาพดาวเทียม</p>`;
  if (wasHidden && innerWidth > 860) map.easeTo({ center: lngLat, padding: framePadding(), duration: 600 });

  api.reverse(lat, lng).then(d => {
    if (seq !== inspectSeq || !d.address) return;
    const a = d.address;
    const parts = [a.village || a.suburb || a.town || a.city_district || a.municipality,
      a.county || a.district, a.state || a.province].filter(Boolean);
    if (parts.length) $("detail-title").textContent = [...new Set(parts)].join(" · ");
  }).catch(() => {});

  const [flood, viirsFlood, opera, aod, aodViirs, rain, soil] = await Promise.all(
    ["modis_flood", "viirs_flood", "opera", "aod", "aod_viirs", "imerg", "smap"].map(id => readValue(L(id), lngLat)));
  // สถานีใกล้สุดที่มีข้อมูลภายใน 2 วัน (บางสถานีหยุดส่งข้อมูลหลายวัน)
  let nearest = null;
  try {
    await loadStations();
    const fresh = stations.filter(s => s.date >= addDays(todayUTC(), -2));
    for (const s of fresh.length ? fresh : stations) {
      const d = distanceKm(lngLat, [s.lon, s.lat]);
      if (!nearest || d < nearest.d) nearest = { ...s, d };
    }
  } catch { /* โหลดข้อมูลสถานีไม่สำเร็จ */ }
  if (seq !== inspectSeq) return;

  const dateNote = r => r.date !== state.date ? `ใช้ข้อมูลวันที่ ${fmtThaiDate(r.date)} (ล่าสุดที่มี)` : "";
  // ใส่คำอธิบายเฉพาะประเภทที่ต้องตีความ (น้ำท่วม/ท่วมตามฤดูกาล/เมฆบัง)
  const classNote = r => [["Flood", "Recurring Flood", "Insufficient Data", "Open Water"].includes(r.label) ? CLASS_INFO[r.label] : "",
    dateNote(r)].filter(Boolean).join(" · ");
  const floodColor = r => r.rgb && !r.empty ? `rgb(${r.rgb})` : "";
  const aodPick = !aod.empty ? aod : aodViirs;
  const pm = nearest && pmLevel(nearest.pm25);

  let html = `<section><h3>🌊 น้ำท่วม</h3>
    ${metric("", "MODIS (2 วัน)", esc(flood.text), classNote(flood), floodColor(flood))}
    ${metric("", "VIIRS (2 วัน)", esc(viirsFlood.text), classNote(viirsFlood), floodColor(viirsFlood))}
    ${metric("", "เรดาร์ 30 ม.", esc(opera.text), opera.empty ? "Sentinel-1 ถ่ายพื้นที่เดิมทุก 6–12 วัน ลองเลื่อนวันที่" : classNote(opera), floodColor(opera))}
  </section>
  <section><h3>💨 ฝุ่นละออง</h3>
    ${nearest && nearest.d > 50 ? metric("", "PM2.5 สถานี", "ไม่มีสถานีใกล้",
      `สถานีใกล้สุดอยู่ห่าง ${nearest.d.toFixed(0)} กม. (${esc(nearest.name)}) ไกลเกินกว่าจะใช้แทนพื้นที่นี้ได้ · ดูค่า AOD ด้านล่างแทน`) :
      nearest ? metric("", `PM2.5 สถานีใกล้สุด`, `${nearest.pm25} µg/m³`,
      `${esc(nearest.name)} (ห่าง ${nearest.d.toFixed(0)} กม.) · ${pm[2]} · ${esc(nearest.date)} ${esc(nearest.time)} น.`, pm[1]) :
      metric("", "PM2.5 สถานี", "—", "โหลดข้อมูลสถานีไม่สำเร็จ")}
    ${metric("", `AOD ${aodPick === aod ? "MODIS" : "VIIRS"}`, aodPick.empty ? esc(aodPick.text) : aodPick.num.toFixed(2),
      aodPick.empty ? dateNote(aodPick) : `${aodLevel(aodPick.num)}${dateNote(aodPick) ? " · " + dateNote(aodPick) : ""}`)}
  </section>
  <section><h3>🌧️ ฝนและดิน</h3>
    ${metric("", "อัตราฝน (IMERG)", esc(rain.text), [rain.num != null ? rainLevel(rain.num) : "", dateNote(rain)].filter(Boolean).join(" · "))}
    ${metric("", "ความชื้นในดิน (SMAP)", soil.empty ? esc(soil.text) : `${soil.num.toFixed(2)} m³/m³`,
      [soil.num != null ? soilLevel(soil.num) : "", dateNote(soil)].filter(Boolean).join(" · "))}
  </section>
  <section><h3>แนวโน้ม 14 วัน</h3><div id="trend"><p class="loading">กำลังดึงข้อมูลย้อนหลัง</p></div></section>`;
  $("detail-body").innerHTML = html;
  loadTrend(lngLat, seq);
}

async function loadTrend(lngLat, seq) {
  const days = Array.from({ length: 14 }, (_, i) => addDays(state.date, i - 13));
  const series = async id => Promise.all(days.map(d => {
    const layer = L(id);
    const end = state.latest[layer.gibs]?.end?.slice(0, 10);
    return end && d > end ? { empty: true, missing: true } : readValue(layer, lngLat, d);
  }));
  const [rain, aod, flood] = await Promise.all([series("imerg"), series("aod"), series("modis_flood")]);
  if (seq !== inspectSeq) return;
  $("trend").innerHTML =
    barChart("ฝน (mm/ชม.)", days, rain.map(r => r.num), "#3d8bff") +
    barChart("ฝุ่น AOD", days, aod.map(r => r.num), "#ffb020", 0.5) +
    floodStrip(days, flood);
}

function barChart(title, days, values, color, threshold) {
  const W = 320, H = 92, pad = { l: 4, r: 4, t: 6, b: 18 };
  const valid = values.filter(v => v != null);
  const max = Math.max(threshold ?? 0, ...valid, 0.01) * 1.1;
  const bw = (W - pad.l - pad.r) / days.length;
  const y = v => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  let svg = "";
  if (threshold) svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(threshold)}" y2="${y(threshold)}" stroke="#ff5a4f" stroke-dasharray="3 3" stroke-width="1"/>`;
  days.forEach((d, i) => {
    const v = values[i], x = pad.l + i * bw;
    if (v == null) {
      svg += `<rect x="${x + 2}" y="${H - pad.b - 2}" width="${bw - 4}" height="2" fill="#94a0b4" opacity=".4"><title>${fmtThaiDate(d)}: ไม่มีข้อมูล</title></rect>`;
    } else {
      svg += `<rect x="${x + 2}" y="${y(v)}" width="${bw - 4}" height="${Math.max(1, H - pad.b - y(v))}" rx="2" fill="${color}"><title>${fmtThaiDate(d)}: ${v.toFixed(2)}</title></rect>`;
    }
    if (i % 3 === 1 || i === days.length - 1) svg += `<text x="${x + bw / 2}" y="${H - 4}" fill="#94a0b4" font-size="10" text-anchor="middle">${+d.slice(8)}/${+d.slice(5, 7)}</text>`;
  });
  const peak = valid.length ? Math.max(...valid) : null;
  return `<div class="chart-wrap"><div class="chart-title"><span>${title}</span><b>${peak != null ? `สูงสุด ${peak.toFixed(2)} · มีข้อมูล ${valid.length}/${days.length} วัน` : "ไม่มีข้อมูล"}</b></div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${title}">${svg}</svg></div>`;
}

function floodStrip(days, values) {
  const W = 320, H = 34, bw = W / days.length;
  const cells = days.map((d, i) => {
    const r = values[i];
    const fill = r.rgb && !r.empty ? `rgb(${r.rgb})` : "rgba(148,160,180,.15)";
    return `<rect x="${i * bw + 1}" y="2" width="${bw - 2}" height="18" rx="3" fill="${fill}"><title>${fmtThaiDate(d)}: ${esc(r.text || "ไม่มีข้อมูล")}</title></rect>`;
  }).join("");
  const flooded = values.filter(r => r.label === "Flood").length;
  return `<div class="chart-wrap"><div class="chart-title"><span>สถานะน้ำ (MODIS)</span><b>${flooded ? `พบน้ำท่วม ${flooded} วัน` : "ไม่พบน้ำท่วม"}</b></div>
    <svg class="chart" style="height:34px" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="สถานะน้ำรายวัน">${cells}</svg></div>`;
}

map.on("click", ev => {
  if (ev.defaultPrevented) return;
  inspect([ev.lngLat.lng, ev.lngLat.lat]);
});
$("detail-close").onclick = () => {
  $("detail").hidden = true;
  state.inspected = null;
  pin?.remove();
};

// ---------------------------------------------------------------- ค้นหา
let searchTimer;
$("search-input").oninput = e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) return ($("search-results").hidden = true);
  searchTimer = setTimeout(async () => {
    try {
      const res = await api.search(q);
      $("search-results").innerHTML = res.length
        ? res.map((r, i) => `<button type="button" data-i="${i}">${esc(r.display_name)}</button>`).join("")
        : `<button type="button" disabled>ไม่พบสถานที่</button>`;
      $("search-results").hidden = false;
      $("search-results").querySelectorAll("[data-i]").forEach(b => b.onclick = () => {
        const r = res[b.dataset.i];
        const [s, n, w, e2] = r.boundingbox.map(Number);
        map.fitBounds([[w, s], [e2, n]], { padding: framePadding(), maxZoom: 11 });
        $("search-results").hidden = true;
        $("search-input").value = r.name || r.display_name.split(",")[0];
        inspect([+r.lon, +r.lat]);
      });
    } catch (err) {
      toast("ค้นหาไม่สำเร็จ ลองใหม่อีกครั้ง");
    }
  }, 450);
};
$("search").onsubmit = e => { e.preventDefault(); $("search-results").querySelector("[data-i]")?.click(); };
document.addEventListener("click", e => { if (!$("search").contains(e.target)) $("search-results").hidden = true; });

// ---------------------------------------------------------------- เริ่มต้น
buildSidebar();
document.querySelectorAll("#modes button").forEach(b => b.onclick = whenReady(() => setMode(b.dataset.mode)));
$("date").max = todayUTC();
$("date").onchange = whenReady(e => setDate(e.target.value));
$("date-prev").onclick = whenReady(() => setDate(addDays(state.date, -1)));
$("date-next").onclick = whenReady(() => setDate(addDays(state.date, 1)));
$("date-latest").onclick = whenReady(() => setDate(addDays(todayUTC(), -1)));
$("play").onclick = whenReady(togglePlay);
$("btn-layers").onclick = () => $("sidebar").classList.toggle("open");

$("date").value = state.date;

map.on("load", async () => {
  ready = true;
  setMode("flood");
  setDate(state.date, { quiet: true });
  // วันล่าสุดของแต่ละชั้นข้อมูล: โหลดตามหลังเพื่อไม่ให้หน้าเว็บต้องรอ
  try {
    state.latest = await api.gibsLatest();
    setDate(state.date, { quiet: true });
    if (state.inspected) inspect(state.inspected);
  } catch { /* ไม่รู้วันล่าสุดของแต่ละชั้น: ใช้วันที่ที่เลือกตรง ๆ */ }
  setInterval(() => {
    const h = OVERLAYS.find(o => o.latestOnly);
    map.getSource("ov-" + h.id).setTiles([mapUrl(h)]);
  }, 6e5);
});
