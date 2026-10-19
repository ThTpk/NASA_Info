"""สร้างไฟล์ข้อมูล static ให้ระบบแผนที่ใช้บน GitHub Pages (ไม่มี server.py)

    monitor/data/air4thai.json      PM2.5 ล่าสุดจากสถานีกรมควบคุมมลพิษ
    monitor/data/gibs-latest.json   วันที่ล่าสุดของชั้น GIBS

GitHub Actions รันสคริปต์นี้ทุกชั่วโมง (.github/workflows/update-data.yml)
ใช้งานเอง:  python update_data.py
"""

import json
from pathlib import Path

from server import fetch_air4thai, fetch_gibs_latest

OUT = Path(__file__).parent / "monitor" / "data"


def write(name, data):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{path} ({path.stat().st_size / 1024:.0f} KB)")


def main():
    # แหล่งใดล้มเหลวให้เขียน error ไว้แทน หน้าเว็บจะแจ้งผู้ใช้ และส่วนอื่นยัง deploy ได้
    for name, fetch in [("air4thai.json", fetch_air4thai), ("gibs-latest.json", fetch_gibs_latest)]:
        try:
            write(name, fetch())
        except Exception as e:
            print(f"WARNING: {name}: {e}")
            write(name, {"error": f"ดึงข้อมูลไม่สำเร็จ: {e}"})


if __name__ == "__main__":
    main()
