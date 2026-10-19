"""อ่าน NASA API key จากไฟล์ .env (ถ้าไม่มีจะใช้ DEMO_KEY)

ใช้งาน:
    from nasa_config import NASA_API_KEY
"""

import os
from pathlib import Path


def load_api_key():
    key = os.environ.get("NASA_API_KEY", "").strip()
    env_file = Path(__file__).with_name(".env")
    if not key and env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("NASA_API_KEY="):
                key = line.split("=", 1)[1].strip().strip("\"'")
    return key or "DEMO_KEY"


NASA_API_KEY = load_api_key()
