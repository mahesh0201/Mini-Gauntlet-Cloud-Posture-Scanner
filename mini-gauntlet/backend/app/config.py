import os
from pathlib import Path


def get_inventory_path() -> Path:
    default_path = Path(__file__).resolve().parents[2] / "data" / "inventory.json"
    return Path(os.getenv("INVENTORY_PATH", str(default_path)))


def get_db_path() -> Path:
    default_path = Path(__file__).resolve().parents[1] / "data" / "mini_gauntlet.db"
    return Path(os.getenv("DB_PATH", str(default_path)))


def get_worker_limit() -> int:
    raw = os.getenv("SCAN_WORKERS", "4")
    try:
        val = int(raw)
        return max(1, val)
    except ValueError:
        return 4
