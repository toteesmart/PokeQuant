import sqlite3
import json
import os
import urllib.request
import urllib.error
import time
import tempfile
import uuid
import gc
import re
import traceback
from datetime import date, timedelta, datetime, timezone
from typing import List, Dict, Any, Tuple
import streamlit as st

try:
    import js
    IS_BROWSER = True
except ImportError:
    IS_BROWSER = False

R2_CATALOG_URL = "https://pub-81d2f5a4ba9a4821bc03f0c3375f9536.r2.dev/mobile_catalog.db"
DELTA_SERVER_URL = "https://pub-81d2f5a4ba9a4821bc03f0c3375f9536.r2.dev/deltas/latest_delta.json"

def _resolve_catalog_path() -> str:
    """Desktop/web: use the PWA's R2 master if a local seed isn't already present."""
    if IS_BROWSER:
        # PWA mounts mobile_catalog.db via the service worker; pokemon_tcg.db is never shipped.
        return 'mobile_catalog.db'

    candidates = []
    if os.access(os.getcwd(), os.W_OK):
        candidates.append(os.path.join(os.getcwd(), 'mobile_catalog.db'))
    candidates.append(os.path.join(tempfile.gettempdir(), 'pokequant_mobile_catalog.db'))

    existing = next((p for p in candidates if os.path.exists(p)), None)
    if existing:
        return existing

    target = candidates[0]
    try:
        req = urllib.request.Request(R2_CATALOG_URL, headers={'User-Agent': 'PokeQuant-Desktop'})
        with urllib.request.urlopen(req, timeout=240) as response, open(target, 'wb') as f:
            while True:
                chunk = response.read(65536)
                if not chunk:
                    break
                f.write(chunk)
    except Exception:
        pass

    return target if os.path.exists(target) else 'pokemon_tcg.db'

DB_NAME = _resolve_catalog_path()

DEFAULT_SETTINGS = {
    "ui_mode": "Vendor (Retail)",
    "buy_tiers": [
        {"min": 0.0, "max": 2.0, "rate": 50},
        {"min": 2.0, "max": 20.0, "rate": 60},
        {"min": 20.0, "max": 50.0, "rate": 70},
        {"min": 50.0, "max": 150.0, "rate": 75},
        {"min": 150.0, "max": 999999.0, "rate": 80},
    ],
    "condition_ratios": {
        "Near Mint": 1.00,
        "Lightly Played": 0.85,
        "Moderately Played": 0.70,
        "Heavily Played": 0.50,
        "Damaged": 0.30,
        "Unknown": 1.00
    },
    "sticker_rules": {
        "mode": "Custom Cutoff",
        "cutoff_threshold": 0.30,
        "min_sticker_price": 1.00
    }
}

# --- SERVICE WORKER HARD DISK BRIDGES ---
def _hard_save(key: str, data: Any):
    """Synchronous IndexedDB write through the Service Worker.

    Uses js.XMLHttpRequest (sync open) to avoid the Pyodide WebWorker
    event-loop deadlocks that can occur with promise-based fetch/urllib
    bridges during Streamlit reruns.
    """
    if not IS_BROWSER: return
    try:
        origin = js.self.location.origin
        url = f"{origin}/offline-db/save"
        payload = json.dumps({"key": key, "value": data})
        req = js.XMLHttpRequest.new()
        req.open("POST", url, False)
        try:
            req.timeout = 6000
        except Exception:
            pass
        req.setRequestHeader("Content-Type", "application/json")
        req.send(payload)
        if req.status >= 400:
            raise Exception(f"HTTP {req.status}: {req.responseText}")
    except Exception:
        pass

def _hard_load(key: str) -> Any:
    """Synchronous IndexedDB read through the Service Worker."""
    if not IS_BROWSER: return None
    try:
        origin = js.self.location.origin
        url = f"{origin}/offline-db/load?key={key}"
        req = js.XMLHttpRequest.new()
        req.open("GET", url, False)
        try:
            req.timeout = 6000
        except Exception:
            pass
        req.send()
        if req.status >= 400:
            raise Exception(f"HTTP {req.status}: {req.responseText}")
        response_data = json.loads(req.responseText)
        return response_data.get("value")
    except Exception:
        return None

def get_beta_key() -> str:
    # 1. Prioritize active Streamlit session (fixes local desktop testing)
    if "beta_key" in st.session_state and st.session_state.beta_key:
        return st.session_state.beta_key
        
    # 2. Fallback to browser hard-disk (PWA)
    if IS_BROWSER:
        key = _hard_load("pokequant_beta_key")
        if key: return str(key)
        
    return "default_vendor"


def _safe_beta_slug() -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", str(get_beta_key()))


def _scoped_storage_key(base: str) -> str:
    return f"{base}:{get_beta_key()}"


def _scoped_local_path(base: str) -> str:
    return f"{base}_{_safe_beta_slug()}.json"


# --- SENTRY TELEMETRY BRIDGE (cross-runtime) ---
SENTRY_DSN = "https://98e220bf4dc773ffbc857d587e0138d7@o4512001935278080.ingest.us.sentry.io/4512001944322048"
SENTRY_RELEASE = "pokequant-beta-0.9"


def _parse_sentry_dsn(dsn: str) -> Dict[str, str]:
    """Parse a Sentry DSN into its endpoint parts."""
    m = re.match(r"^(https?)://([^@]+)@([^/]+)/(.+)$", dsn)
    if not m:
        return None
    return {
        "protocol": m.group(1),
        "public_key": m.group(2),
        "host": m.group(3).strip(),
        "project_id": m.group(4).strip(),
    }


def _sentry_event_id() -> str:
    return uuid.uuid4().hex


def _sentry_utc_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _build_sentry_envelope(message: str, level: str = "error", extra: Dict[str, Any] = None) -> str:
    """Build a minimal Sentry envelope (newline-delimited JSON)."""
    event_id = _sentry_event_id()
    ts = _sentry_utc_timestamp()

    if extra is None:
        extra = {}
    # Coerce extras to safe strings to keep the payload small and serializable.
    safe_extra = {}
    for k, v in extra.items():
        try:
            safe_extra[str(k)] = str(v)[:500]
        except Exception:
            safe_extra[str(k)] = "[unserializable]"

    # Truncate oversized messages to avoid mobile payload blowout.
    if len(message) > 2048:
        message = message[:2048] + "...[truncated]"

    tags = {"release": SENTRY_RELEASE, "runtime": "browser" if IS_BROWSER else "desktop"}
    try:
        tags["vendor_id"] = get_beta_key()
    except Exception:
        tags["vendor_id"] = "unknown"

    payload = {
        "event_id": event_id,
        "timestamp": ts,
        "platform": "python",
        "level": level,
        "message": message,
        "logger": "pokequant",
        "release": SENTRY_RELEASE,
        "environment": "browser" if IS_BROWSER else "desktop",
        "tags": tags,
        "extra": safe_extra,
    }

    payload_json = json.dumps(payload)
    payload_len = len(payload_json.encode("utf-8"))

    envelope_header = {"event_id": event_id, "dsn": SENTRY_DSN, "sent_at": ts}
    item_header = {"type": "event", "length": payload_len, "content_type": "application/json"}

    return "\n".join([
        json.dumps(envelope_header),
        json.dumps(item_header),
        payload_json,
        "",
    ])


def _sentry_ingest_url(dsn_parts: Dict[str, str]) -> str:
    return (
        f"{dsn_parts['protocol']}://{dsn_parts['host']}"
        f"/api/{dsn_parts['project_id']}/envelope/"
        f"?sentry_key={dsn_parts['public_key']}&sentry_version=7"
    )


def log_to_sentry(error_msg: str, level: str = "error", extra: Dict[str, Any] = None):
    """Send a log message to Sentry from browser (Pyodide worker) or desktop Python.

    Works even when js.Sentry is unavailable because the browser SDK lives in the
    main document context, not the Pyodide WebWorker. We fall back to a direct
    synchronous POST to Sentry's envelope endpoint using XMLHttpRequest in the
    worker or urllib on the desktop.
    """
    # Fast path: if Sentry is somehow visible in the JS global, use it.
    try:
        if js is not None and hasattr(js, "Sentry"):
            js.Sentry.captureMessage(f"PokeQuant UI/Backend Error: {error_msg}", level)
            return
    except Exception:
        pass

    try:
        dsn = _parse_sentry_dsn(SENTRY_DSN)
        if not dsn:
            return
        body = _build_sentry_envelope(error_msg, level, extra)
        url = _sentry_ingest_url(dsn)
        encoded = body.encode("utf-8")

        if IS_BROWSER:
            req = js.XMLHttpRequest.new()
            req.open("POST", url, False)  # synchronous to avoid Pyodide event-loop deadlocks
            req.setRequestHeader("Content-Type", "application/x-sentry-envelope")
            try:
                req.timeout = 6000
            except Exception:
                pass
            req.send(body)
        else:
            request = urllib.request.Request(
                url,
                data=encoded,
                headers={"Content-Type": "application/x-sentry-envelope"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=6) as resp:
                resp.read()
    except Exception:
        # Never let telemetry crash the app.
        pass


def log_exception_to_sentry(exc: BaseException, context: str = "", level: str = "error"):
    """Format an exception with traceback and ship it to Sentry."""
    try:
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    except Exception:
        tb = str(exc)
    msg = f"{context}: {exc}\n\n{tb}" if context else f"{exc}\n\n{tb}"
    log_to_sentry(msg, level=level)


# --- LOCAL STORAGE ENGINE ---
def _normalize_pending_sync(stmt: Dict[str, Any], beta_key: str) -> Dict[str, Any]:
    sql = stmt.get("sql", "")
    upper = sql.strip().upper()
    if "INVENTORY" in upper and "INSERT" in upper and "user_id" not in upper:
        m = re.search(r"INSERT\s+(?:OR\s+\w+\s+)?INTO\s+inventory\s*\(([^)]+)\)", sql, re.IGNORECASE)
        if m:
            cols = [c.strip() for c in m.group(1).split(",")]
            vm = re.search(r"VALUES\s*\(([^)]+)\)", sql, re.IGNORECASE)
            if vm:
                vals = [v.strip() for v in vm.group(1).split(",")]
                if "user_id" not in [c.lower() for c in cols] and len(vals) == len(cols):
                    cols.append("user_id")
                    vals.append("?")
                    new_sql = f"INSERT OR REPLACE INTO inventory ({', '.join(cols)}) VALUES ({', '.join(vals)})"
                    args = list(stmt.get("args", []))
                    args.append(beta_key)
                    stmt["sql"] = new_sql
                    stmt["args"] = args
    elif "INVENTORY" in upper and "UPDATE" in upper and "user_id" not in upper:
        if "WHERE" in upper:
            stmt["sql"] = sql.rstrip("; \n") + " AND user_id = ?"
        else:
            stmt["sql"] = sql.rstrip("; \n") + " WHERE user_id = ?"
        stmt["args"] = list(stmt.get("args", [])) + [beta_key]
    return stmt

def load_local_inventory() -> List[Dict[str, Any]]:
    data = None
    if IS_BROWSER:
        data = _hard_load(_scoped_storage_key("pokequant_inventory"))
    scoped_path = _scoped_local_path("local_inv")
    if not data and os.path.exists(scoped_path):
        try:
            with open(scoped_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            pass
    if not data and os.path.exists("local_inv.json"):
        try:
            with open("local_inv.json", "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            pass
    if data:
        beta_key = get_beta_key()
        for item in data:
            item.setdefault("user_id", beta_key)
    return data if data else []

def save_local_inventory(inventory_list: List[Dict[str, Any]]):
    if IS_BROWSER:
        _hard_save(_scoped_storage_key("pokequant_inventory"), inventory_list)
    scoped_path = _scoped_local_path("local_inv")
    try:
        with open(scoped_path, "w", encoding="utf-8") as f:
            json.dump(inventory_list, f, indent=2)
    except Exception:
        pass

def get_pending_syncs() -> List[Dict[str, Any]]:
    data = None
    if IS_BROWSER:
        data = _hard_load(_scoped_storage_key("pokequant_pending_sync"))
    scoped_path = _scoped_local_path("local_syncs")
    if not data and os.path.exists(scoped_path):
        try:
            with open(scoped_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            pass
    if not data and os.path.exists("local_syncs.json"):
        try:
            with open("local_syncs.json", "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            pass
    syncs = data if data else []
    beta_key = get_beta_key()
    return [_normalize_pending_sync(s, beta_key) for s in syncs]

def add_pending_sync(sql: str, args: list):
    syncs = get_pending_syncs()
    syncs.append({"sql": sql, "args": args})
    if IS_BROWSER:
        _hard_save(_scoped_storage_key("pokequant_pending_sync"), syncs)
    scoped_path = _scoped_local_path("local_syncs")
    try:
        with open(scoped_path, "w", encoding="utf-8") as f:
            json.dump(syncs, f, indent=2)
    except Exception:
        pass

def get_pending_sync_count() -> int:
    return len(get_pending_syncs())

# --- GLOBAL SYNC TIMESTAMPS ---
def get_local_sync_time() -> float:
    data = None
    if IS_BROWSER:
        data = _hard_load(_scoped_storage_key("pokequant_sync_time"))
    if data is not None:
        try:
            return float(data)
        except Exception:
            pass
    scoped_path = _scoped_local_path("local_sync_time")
    if os.path.exists(scoped_path):
        try:
            with open(scoped_path, "r") as f:
                return float(json.load(f).get("last_sync", 0.0))
        except Exception:
            pass
    if os.path.exists("local_sync_time.json"):
        try:
            with open("local_sync_time.json", "r") as f:
                return float(json.load(f).get("last_sync", 0.0))
        except Exception:
            pass
    return 0.0

def save_local_sync_time(timestamp: float):
    if IS_BROWSER:
        _hard_save(_scoped_storage_key("pokequant_sync_time"), str(timestamp))
    scoped_path = _scoped_local_path("local_sync_time")
    try:
        with open(scoped_path, "w") as f:
            json.dump({"last_sync": timestamp}, f)
    except Exception:
        pass

def get_remote_sync_time_cached(ttl: float = 120.0) -> float:
    """Return the remote sync time from the in-memory or JS-poller cache.

    This helper never performs a network request. The background JS poller in
    index.html is the only source that refreshes the cached remote sync time.
    If no cached value is available yet, return 0.0 so the UI can show a
    non-blocking 'checking...' state.
    """
    now = time.time()
    in_mem_key = _scoped_storage_key("_pq_remote_sync_time")
    in_mem_ts_key = _scoped_storage_key("_pq_remote_sync_time_ts")

    in_mem = st.session_state.get(in_mem_key)
    in_mem_ts = st.session_state.get(in_mem_ts_key)
    if in_mem is not None and in_mem_ts is not None and (now - float(in_mem_ts)) < ttl:
        return float(in_mem)

    if IS_BROWSER:
        try:
            js_cached = _hard_load(_scoped_storage_key("__pq_remote_sync_time"))
            if js_cached and isinstance(js_cached, dict):
                js_time = float(js_cached.get("time", 0.0))
                js_ts = float(js_cached.get("ts", 0.0))
                if (now - js_ts) < ttl:
                    st.session_state[in_mem_key] = js_time
                    st.session_state[in_mem_ts_key] = js_ts
                    return js_time
        except Exception:
            pass

    return 0.0

# --- TURSO HTTP REST CLIENT ---
def get_turso_credentials() -> Tuple[str, str]:
    url, token = "", ""
    if IS_BROWSER:
        url = _hard_load("turso_url") or ""
        token = _hard_load("turso_token") or ""
            
    if not url or not token:
        if os.path.exists("local_creds.json"):
            try:
                with open("local_creds.json", "r", encoding="utf-8") as f:
                    creds = json.load(f)
                    url = url or creds.get("url", "")
                    token = token or creds.get("token", "")
            except Exception:
                pass
    
    if not url or not token:
        try:
            url = url or st.secrets.get("TURSO_DATABASE_URL", "")
            token = token or st.secrets.get("TURSO_AUTH_TOKEN", "")
        except Exception:
            pass
            
    if url:
        url = url.strip().replace("libsql://", "https://")
        if not url.startswith("http"):
            url = f"https://{url}"
            
    return url, token.strip() if token else ""

def save_turso_credentials(url: str, token: str):
    if IS_BROWSER:
        _hard_save("turso_url", url.strip())
        _hard_save("turso_token", token.strip())
            
    try:
        with open("local_creds.json", "w", encoding="utf-8") as f:
            json.dump({"url": url.strip(), "token": token.strip()}, f)
    except Exception:
        pass

def parse_turso_results(response_text: str) -> List[List[Dict[str, Any]]]:
    data = json.loads(response_text)
    results = []
    
    for res in data.get("results", []):
        if res.get("type") == "ok" and "response" in res:
            resp = res["response"]
            if resp.get("type") == "execute" and "result" in resp:
                cols = [c["name"] for c in resp["result"].get("cols", [])]
                rows = []
                for row in resp["result"].get("rows", []):
                    row_dict = {}
                    for col_name, cell in zip(cols, row):
                        val = cell.get("value")
                        if cell.get("type") == "integer": 
                            val = int(val) if val is not None else None
                        elif cell.get("type") == "float": 
                            val = float(val) if val is not None else None
                        row_dict[col_name] = val
                    rows.append(row_dict)
                results.append(rows)
    return results

def turso_execute_sync(statements: List[Dict[str, Any]], override_url: str = None, override_token: str = None) -> List[List[Dict[str, Any]]]:
    url, token = get_turso_credentials()
    
    if override_url is not None:
        url = override_url
    if override_token is not None:
        token = override_token
        
    if not url:
        raise Exception("Missing Database URL (Cloudflare Worker endpoint). Set it in Vendor Settings.")
        
    endpoint = f"{url.rstrip('/')}/v2/pipeline"
    if url.endswith(".workers.dev"):
        endpoint = url.rstrip('/') # Use root for Cloudflare Worker proxy
        
    requests_payload = []
    
    for stmt in statements:
        turso_args = []
        for arg in stmt.get("args", []):
            if isinstance(arg, bool): 
                turso_args.append({"type": "integer", "value": str(int(arg))})
            elif isinstance(arg, int): 
                turso_args.append({"type": "integer", "value": str(arg)})
            elif isinstance(arg, float): 
                turso_args.append({"type": "float", "value": float(arg)})
            elif arg is None: 
                turso_args.append({"type": "null"})
            else: 
                turso_args.append({"type": "text", "value": str(arg)})
        
        requests_payload.append({
            "type": "execute",
            "stmt": {"sql": stmt["sql"], "args": turso_args}
        })
    requests_payload.append({"type": "close"})
    
    payload_json = json.dumps({"requests": requests_payload})
    beta_key = get_beta_key()
    
    if IS_BROWSER:
        try:
            req = js.XMLHttpRequest.new()
            req.open("POST", endpoint, False)
            try:
                req.timeout = 15000
            except Exception:
                pass
            if token:
                req.setRequestHeader("Authorization", f"Bearer {token}")
            req.setRequestHeader("X-Beta-Key", beta_key)
            req.setRequestHeader("Content-Type", "application/json")
            req.send(payload_json)
            
            if req.status >= 400:
                raise Exception(f"HTTP {req.status}: {req.responseText}")
            res_text = req.responseText
        except Exception as e:
            raise Exception(f"Browser Network Error: {str(e)}")
    else:
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 PokeQuant/1.0",
            "X-Beta-Key": beta_key
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
            
        req = urllib.request.Request(
            endpoint, 
            data=payload_json.encode("utf-8"), 
            headers=headers
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                res_text = response.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            raise Exception(f"HTTP {e.code}: {err_body}")
        except Exception as e:
            raise Exception(f"Network Error: {str(e)}")
            
    res_data = json.loads(res_text)
    for res in res_data.get("results", []):
        if res.get("type") == "error":
            err_msg = res.get("error", {}).get("message", "Unknown Turso Error")
            raise Exception(err_msg)
            
    return parse_turso_results(res_text)

SCHEMA_VERSION = 1


def _ensure_turso_schema() -> None:
    """Create the Turso tables and backfill any missing columns."""
    beta_key = get_beta_key()

    init_stmts = [
        {
            "sql": """
            CREATE TABLE IF NOT EXISTS inventory (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                product_id INTEGER,
                card_name TEXT,
                card_number TEXT,
                set_name TEXT,
                variant TEXT,
                condition TEXT,
                purchase_price REAL,
                sticker_price REAL,
                date_bought TEXT,
                is_bulk_deal INTEGER,
                is_sold INTEGER DEFAULT 0,
                sold_price REAL DEFAULT 0.0,
                date_sold TEXT DEFAULT '',
                custom_image_data TEXT,
                is_deleted INTEGER DEFAULT 0,
                updated_at REAL NOT NULL
            )
            """,
            "args": []
        },
        {"sql": "CREATE TABLE IF NOT EXISTS vendor_settings (user_id TEXT PRIMARY KEY, settings_json TEXT NOT NULL, updated_at REAL DEFAULT 0.0)", "args": []},
        {"sql": "CREATE TABLE IF NOT EXISTS sync_metadata (user_id TEXT PRIMARY KEY, last_updated REAL)", "args": []}
    ]
    turso_execute_sync(init_stmts)

    existing_cols: Dict[str, set] = {}
    try:
        col_results = turso_execute_sync([
            {"sql": "SELECT name FROM pragma_table_info('inventory')", "args": []},
            {"sql": "SELECT name FROM pragma_table_info('vendor_settings')", "args": []},
            {"sql": "SELECT name FROM pragma_table_info('sync_metadata')", "args": []}
        ])
        if col_results:
            if len(col_results) > 0:
                existing_cols["inventory"] = {r.get("name") for r in col_results[0] if r.get("name")}
            if len(col_results) > 1:
                existing_cols["vendor_settings"] = {r.get("name") for r in col_results[1] if r.get("name")}
            if len(col_results) > 2:
                existing_cols["sync_metadata"] = {r.get("name") for r in col_results[2] if r.get("name")}
    except Exception:
        existing_cols = {}

    inv_cols = existing_cols.get("inventory", set())
    vs_cols = existing_cols.get("vendor_settings", set())
    sync_cols = existing_cols.get("sync_metadata", set())

    # Inspect existing columns so we only attempt migrations that are actually needed.
    migrations = []
    if "user_id" not in inv_cols:
        migrations.append({"sql": "ALTER TABLE inventory ADD COLUMN user_id TEXT DEFAULT NULL", "args": []})
    if "is_deleted" not in inv_cols:
        migrations.append({"sql": "ALTER TABLE inventory ADD COLUMN is_deleted INTEGER DEFAULT 0", "args": []})
    if "updated_at" not in inv_cols:
        migrations.append({"sql": "ALTER TABLE inventory ADD COLUMN updated_at REAL DEFAULT 0.0", "args": []})
    if "custom_image_data" not in inv_cols:
        migrations.append({"sql": "ALTER TABLE inventory ADD COLUMN custom_image_data TEXT", "args": []})
    if "sold_price" not in inv_cols:
        migrations.append({"sql": "ALTER TABLE inventory ADD COLUMN sold_price REAL DEFAULT 0.0", "args": []})
    if "date_sold" not in inv_cols:
        migrations.append({"sql": "ALTER TABLE inventory ADD COLUMN date_sold TEXT", "args": []})
    if "is_sold" not in inv_cols:
        migrations.append({"sql": "ALTER TABLE inventory ADD COLUMN is_sold INTEGER DEFAULT 0", "args": []})
    if "updated_at" not in vs_cols:
        migrations.append({"sql": "ALTER TABLE vendor_settings ADD COLUMN updated_at REAL DEFAULT 0.0", "args": []})

    if migrations:
        try:
            turso_execute_sync(migrations)
        except Exception:
            for stmt in migrations:
                try:
                    turso_execute_sync([stmt])
                except Exception:
                    pass

    if "sync_metadata" in existing_cols and "id" in sync_cols and "user_id" not in sync_cols:
        try:
            turso_execute_sync([{"sql": "ALTER TABLE sync_metadata RENAME TO sync_metadata_legacy", "args": []}])
            old = turso_execute_sync([{"sql": "SELECT last_updated FROM sync_metadata_legacy WHERE id = 1", "args": []}])
            old_time = 0.0
            if old and old[0] and len(old[0]) > 0:
                old_time = float(old[0][0].get("last_updated", 0.0))
            turso_execute_sync([
                {"sql": "CREATE TABLE sync_metadata (user_id TEXT PRIMARY KEY, last_updated REAL)", "args": []},
                {"sql": "INSERT OR REPLACE INTO sync_metadata (user_id, last_updated) VALUES (?, ?)", "args": [beta_key, old_time]},
                {"sql": "DROP TABLE sync_metadata_legacy", "args": []}
            ])
        except Exception:
            pass

    try:
        turso_execute_sync([
            {"sql": "UPDATE inventory SET user_id = ? WHERE user_id IS NULL", "args": [beta_key]},
            {"sql": "UPDATE vendor_settings SET user_id = ? WHERE user_id IS NULL", "args": [beta_key]}
        ])
    except Exception:
        pass


def sync_with_cloud() -> Tuple[bool, str]:
    if st.session_state.get("_pq_sync_cloud_busy") or st.session_state.get("_pq_delta_apply_busy"):
        return False, "Cloud sync or catalog update already in progress."
    st.session_state["_pq_sync_cloud_busy"] = True
    st.session_state["_pq_delta_apply_busy"] = True
    try:
        syncs = get_pending_syncs()
        push_time = time.time()
        beta_key = get_beta_key()

        # Ensure remote schema only once per device to avoid repeated round-trips.
        schema_key = _scoped_storage_key("_pq_turso_schema_ready")
        schema_flag = None
        try:
            schema_flag = _hard_load(schema_key) if IS_BROWSER else None
        except Exception:
            pass
        if not st.session_state.get(schema_key) and not (isinstance(schema_flag, dict) and schema_flag.get("version", 0) >= SCHEMA_VERSION):
            _ensure_turso_schema()
            st.session_state[schema_key] = True
            if IS_BROWSER:
                try:
                    _hard_save(schema_key, {"version": SCHEMA_VERSION, "checked_at": push_time})
                except Exception:
                    pass

        # Normalize old pending INSERT statements so re-pushing is idempotent.
        # This makes chunked pushes safe without dropping rows on retry.
        if syncs:
            for stmt in syncs:
                raw_sql = stmt.get("sql", "")
                upper_sql = raw_sql.strip().upper()
                if upper_sql.startswith("INSERT INTO INVENTORY") and "INSERT OR REPLACE" not in upper_sql:
                    stmt["sql"] = raw_sql.replace("INSERT INTO inventory", "INSERT OR REPLACE INTO inventory", 1)

        # Push pending local changes in small batches to keep each sync XHR short.
        if syncs:
            push_stmts = syncs + [
                {"sql": "INSERT OR REPLACE INTO sync_metadata (user_id, last_updated) VALUES (?, ?)", "args": [beta_key, push_time]}
            ]

            batch_size = 500
            if len(push_stmts) <= batch_size:
                turso_execute_sync(push_stmts)
            else:
                for i in range(0, len(push_stmts), batch_size):
                    turso_execute_sync(push_stmts[i:i + batch_size])
                    if IS_BROWSER:
                        gc.collect()

            if IS_BROWSER:
                _hard_save(_scoped_storage_key("pokequant_pending_sync"), [])

            scoped_syncs_path = _scoped_local_path("local_syncs")
            try:
                with open(scoped_syncs_path, "w", encoding="utf-8") as f:
                    json.dump([], f)
            except Exception:
                pass

        pull_stmts = [
            {"sql": "SELECT * FROM inventory WHERE is_deleted = 0 AND user_id = ? ORDER BY updated_at DESC", "args": [beta_key]},
            {"sql": "SELECT settings_json FROM vendor_settings WHERE user_id = ?", "args": [beta_key]},
            {"sql": "SELECT last_updated FROM sync_metadata WHERE user_id = ?", "args": [beta_key]}
        ]
        results = turso_execute_sync(pull_stmts)

        if len(results) > 0:
            merge_cloud_inventory(results[0])

        if len(results) > 1 and len(results[1]) > 0:
            settings_json = results[1][0].get("settings_json")
            if settings_json:
                if isinstance(settings_json, str):
                    try:
                        settings_obj = json.loads(settings_json)
                        if IS_BROWSER:
                            _hard_save(_scoped_storage_key("pokequant_vendor_settings"), settings_obj)
                    except:
                        pass
                scoped_settings_path = _scoped_local_path("local_settings")
                try:
                    with open(scoped_settings_path, "w", encoding="utf-8") as f:
                        f.write(settings_json)
                except Exception:
                    pass

        if len(results) > 2 and len(results[2]) > 0:
            remote_time = float(results[2][0].get("last_updated", push_time))
            save_local_sync_time(remote_time)
        else:
            remote_time = push_time
            save_local_sync_time(push_time)

        return True, "Cloud sync complete!"
    except Exception as e:
        return False, str(e)
    finally:
        st.session_state.pop("_pq_sync_cloud_busy", None)
        st.session_state.pop("_pq_delta_apply_busy", None)

# --- DAILY CATALOG DELTA ENGINE ---
def apply_daily_catalog_delta() -> Tuple[bool, str]:
    if st.session_state.get("_pq_sync_cloud_busy") or st.session_state.get("_pq_delta_apply_busy"):
        return False, "Cloud sync or catalog update already in progress."
    st.session_state["_pq_sync_cloud_busy"] = True
    st.session_state["_pq_delta_apply_busy"] = True
    try:
        if not os.path.exists(DB_NAME):
            return False, "Catalog DB not mounted."

        conn = None
        try:
            conn = sqlite3.connect(DB_NAME, timeout=5)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = {row[0] for row in cursor.fetchall()}
        except Exception:
            return False, "Catalog database missing required tables."
        finally:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass

        if 'cards' not in tables or 'price_history' not in tables:
            return False, "Catalog database missing required tables."

        delta_url = f"{DELTA_SERVER_URL}?t={int(time.time())}"
        headers = {
            'User-Agent': 'PokeQuant-PWA',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        }

        if IS_BROWSER:
            try:
                req = js.XMLHttpRequest.new()
                req.open("GET", delta_url, False)
                try:
                    req.timeout = 15000
                except Exception:
                    pass
                req.setRequestHeader("User-Agent", headers['User-Agent'])
                req.setRequestHeader("Cache-Control", headers['Cache-Control'])
                req.setRequestHeader("Pragma", headers['Pragma'])
                req.send()
                if req.status >= 400:
                    raise Exception(f"HTTP {req.status}: {req.responseText}")
                raw_data = req.responseText
            except Exception as e:
                raise Exception(f"Browser network error fetching delta: {str(e)}")
        else:
            req = urllib.request.Request(delta_url, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as response:
                raw_data = response.read().decode('utf-8')

        delta_data = json.loads(raw_data)

        # Immediately free the raw string memory
        del raw_data
        gc.collect()

        # Extract and detach the heavy payload lists from the container dict
        # so the large JSON object can be reclaimed before inserts begin.
        new_cards = delta_data.pop("new_cards", [])
        price_updates = delta_data.pop("price_updates", [])
        delta_date = delta_data.pop("delta_date", "Today")
        del delta_data
        gc.collect()

        conn = None
        try:
            conn = sqlite3.connect(DB_NAME, timeout=5)
            cursor = conn.cursor()

            # PREVENT MOBILE MEMORY CRASH: Disable the massive SQLite rollback journal
            cursor.execute("PRAGMA journal_mode = OFF")
            cursor.execute("PRAGMA synchronous = OFF")

            # Process the inserts in small chunks of 500 so iOS/Android doesn't run out of RAM
            def chunker(seq, size):
                return (seq[pos:pos + size] for pos in range(0, len(seq), size))

            if new_cards:
                for batch in chunker(new_cards, 500):
                    batch_values = [(int(c["product_id"]), c["card_name"], c["card_number"], c["set_name"], c["rarity"]) for c in batch]
                    cursor.executemany(
                        "INSERT OR REPLACE INTO cards (product_id, card_name, card_number, set_name, rarity) VALUES (?, ?, ?, ?, ?)",
                        batch_values
                    )
                    conn.commit()
                    del batch_values
                    del batch
                    gc.collect()
                del new_cards
                gc.collect()

            if price_updates:
                for batch in chunker(price_updates, 500):
                    batch_values = [(int(p["product_id"]), p["sub_type"], float(p["market_price"]), p["date"]) for p in batch]
                    cursor.executemany(
                        "INSERT OR REPLACE INTO price_history (product_id, sub_type, market_price, date) VALUES (?, ?, ?, ?)",
                        batch_values
                    )
                    conn.commit()
                    del batch_values
                    del batch
                    gc.collect()
                del price_updates
                gc.collect()
        finally:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass

        # Final cleanup sweep after all heavy objects are released.
        gc.collect()

        _hard_save(_scoped_storage_key("pokequant_last_catalog_delta"), delta_date)
        return True, f"Successfully patched cards and prices ({delta_date})!"
    except Exception as e:
        return False, f"Delta update failed: {str(e)}"
    finally:
        st.session_state.pop("_pq_sync_cloud_busy", None)
        st.session_state.pop("_pq_delta_apply_busy", None)

# --- INVENTORY CRUD OPERATIONS (LWW + UUID) ---
def _get_price_map(cursor, product_ids):
    """Batch-fetch recent price history for a list of product IDs.

    Returns {product_id: {sub_type: [(date, market_price), ...]}} ordered
    by date descending, enabling a single round-trip instead of an N+1 query.

    To avoid WASM heap bloat, rows older than 90 days are filtered out in the
    SQL query (and again defensively in the parsing loop). This still provides
    enough data for 1/3/7/30/90-day trend calculations.
    """
    if not product_ids:
        return {}

    # Limit history to the last 90 days so the nested price map stays small.
    cutoff = (date.today() - timedelta(days=90)).isoformat()
    placeholders = ",".join(["?"] * len(product_ids))
    cursor.execute(
        f"SELECT product_id, sub_type, market_price, date FROM price_history WHERE product_id IN ({placeholders}) AND date >= ? ORDER BY product_id, sub_type, date DESC",
        product_ids + [cutoff]
    )

    price_map = {}
    for pid, stype, mp, dt in cursor.fetchall():
        # Defensive guard: drop any date older than the 90-day window.
        clean_dt = str(dt).split(" ")[0].split("T")[0]
        if clean_dt < cutoff:
            continue
        inner = price_map.get(pid)
        if inner is None:
            inner = {}
            price_map[pid] = inner
        variant_list = inner.get(stype)
        if variant_list is None:
            variant_list = []
            inner[stype] = variant_list
        variant_list.append((clean_dt, float(mp)))
    return price_map


def _past_prices_for_inventory(variant_history):
    """Lightweight variant insight used only by inventory: live price + 1/3/7-day past prices.

    Avoids the 90-day window and 30/90-day trend overhead because inventory only needs
    short-term velocity. Uses ISO string comparison for speed.
    """
    if not variant_history:
        return None
    latest_date_str, latest_price = variant_history[0]
    latest_price = float(latest_price)
    latest_date_clean = latest_date_str.split(" ")[0].split("T")[0]
    try:
        latest_date = date.fromisoformat(latest_date_clean)
    except ValueError:
        latest_date = date.today()
    target_dates = {d: (latest_date - timedelta(days=d)).isoformat() for d in (1, 3, 7)}
    past_prices = {}
    for dt_str, pr in variant_history:
        clean_dt = dt_str.split(" ")[0].split("T")[0]
        for days, target in target_dates.items():
            if clean_dt <= target and days not in past_prices:
                past_prices[days] = pr
    oldest_price = variant_history[-1][1]
    for days in target_dates:
        if days not in past_prices:
            past_prices[days] = oldest_price
    return {
        "latest_price": latest_price,
        "latest_date": latest_date_str,
        "latest_date_clean": latest_date_clean,
        "past_prices": past_prices
    }


def _variant_price_insights(variant_history):
    """Extract the latest price, 1/3/7/30/90-day past prices, and 90d high/low."""
    if not variant_history:
        return None
    latest_date_str, latest_price = variant_history[0]
    latest_price = float(latest_price)
    latest_date_clean = latest_date_str.split(" ")[0].split("T")[0]
    try:
        latest_date = date.fromisoformat(latest_date_clean)
    except ValueError:
        latest_date = date.today()
    target_dates = {d: (latest_date - timedelta(days=d)).isoformat() for d in (1, 3, 7, 30, 90)}
    past_prices = {}
    window_90 = []
    for dt_str, pr in variant_history:
        clean_dt = dt_str.split(" ")[0].split("T")[0]
        try:
            d_obj = date.fromisoformat(clean_dt)
        except Exception:
            continue
        days_diff = (latest_date - d_obj).days
        if 0 <= days_diff <= 90:
            window_90.append(pr)
        for days, target in target_dates.items():
            if clean_dt <= target and days not in past_prices:
                past_prices[days] = pr
    oldest_price = variant_history[-1][1]
    for days in target_dates:
        if days not in past_prices:
            past_prices[days] = oldest_price
    high_90 = max(window_90) if window_90 else latest_price
    low_90 = min(window_90) if window_90 else latest_price
    return {
        "latest_price": latest_price,
        "latest_date": latest_date_str,
        "latest_date_clean": latest_date_clean,
        "past_prices": past_prices,
        "high_90": high_90,
        "low_90": low_90
    }


def _analyze_variant_history(variant_history, buy_tiers=None, max_price=None):
    """Build the pricing/trend payload used by search and inventory views."""
    insights = _variant_price_insights(variant_history)
    if insights is None:
        return None
    latest_price = insights["latest_price"]
    if max_price is not None and latest_price > max_price:
        return None
    buy_data = calculate_buy_offer(latest_price, buy_tiers)
    def _fmt_trend(days):
        past = insights["past_prices"].get(days)
        if past is None:
            return "N/A"
        if past == 0:
            return "0.0%"
        return f"{(((latest_price - past) / past) * 100):+.2f}%"
    return {
        "market_price": latest_price,
        "last_updated": insights["latest_date"],
        "buy_rate_pct": buy_data["buy_rate_pct"],
        "cash_offer": buy_data["cash_offer"],
        "trends": {d: _fmt_trend(d) for d in (1, 3, 7, 30, 90)},
        "90d_high": insights["high_90"],
        "90d_low": insights["low_90"]
    }


def get_inventory() -> List[Dict[str, Any]]:
    """Enrich local inventory with batched catalog price and rarity data."""
    inventory_list = load_local_inventory()
    if not inventory_list:
        return []

    product_ids = list({int(item.get('product_id', 0)) for item in inventory_list if item.get('product_id', 0) > 0})
    if not product_ids or not os.path.exists(DB_NAME):
        for item in inventory_list:
            item.setdefault('rarity', 'N/A')
            item['live_market'], item['market_date'] = 0.0, "N/A"
            item['market_1d'], item['market_3d'], item['market_7d'] = 0.0, 0.0, 0.0
        return inventory_list

    try:
        conn = sqlite3.connect(DB_NAME, timeout=5)
        cursor = conn.cursor()
        placeholders = ",".join(["?"] * len(product_ids))

        cursor.execute(f"SELECT product_id, rarity FROM cards WHERE product_id IN ({placeholders})", product_ids)
        rarity_map = {int(k): v for k, v in cursor.fetchall()}

        price_map = _get_price_map(cursor, product_ids)
        conn.close()

        for item in inventory_list:
            pid = int(item.get('product_id', 0))
            item['rarity'] = rarity_map.get(pid, 'Promo' if 'Promo' in str(item.get('set_name', '')) else 'N/A')

            var = item.get('variant', 'Normal')
            var_history = price_map.get(pid, {}).get(var)
            if not var_history and pid in price_map and price_map[pid]:
                var_history = next(iter(price_map[pid].values()))

            if var_history:
                insights = _past_prices_for_inventory(var_history)
                if insights:
                    item['live_market'] = insights['latest_price']
                    item['market_date'] = insights['latest_date_clean']
                    item['market_1d'] = insights['past_prices'].get(1, insights['latest_price'])
                    item['market_3d'] = insights['past_prices'].get(3, insights['latest_price'])
                    item['market_7d'] = insights['past_prices'].get(7, insights['latest_price'])
                else:
                    item['live_market'], item['market_date'] = 0.0, "N/A"
                    item['market_1d'], item['market_3d'], item['market_7d'] = 0.0, 0.0, 0.0
            else:
                item['live_market'], item['market_date'] = 0.0, "N/A"
                item['market_1d'], item['market_3d'], item['market_7d'] = 0.0, 0.0, 0.0
    except Exception:
        for item in inventory_list:
            item.setdefault('rarity', 'N/A')
            item['live_market'], item['market_date'] = 0.0, "N/A"
            item['market_1d'], item['market_3d'], item['market_7d'] = 0.0, 0.0, 0.0

    return inventory_list

def add_inventory_item(product_id, card_name, card_number, set_name, variant, condition, purchase_price, sticker_price, date_bought, is_bulk, custom_image_data=None):
    now_ts = time.time()
    item_id = uuid.uuid4().hex
    bulk_int = 1 if is_bulk else 0
    beta_key = get_beta_key()
    
    sql = """
    INSERT OR REPLACE INTO inventory (id, user_id, product_id, card_name, card_number, set_name, variant, condition, purchase_price, sticker_price, date_bought, is_bulk_deal, is_sold, custom_image_data, is_deleted, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    args = [item_id, beta_key, product_id, card_name, card_number, set_name, variant, condition, purchase_price, sticker_price, str(date_bought), bulk_int, 0, custom_image_data, 0, now_ts]
    add_pending_sync(sql, args)
    
    local_inv = load_local_inventory()
    local_inv.insert(0, {
        "id": item_id,
        "user_id": beta_key,
        "product_id": product_id, "card_name": card_name, "card_number": card_number,
        "set_name": set_name, "variant": variant, "condition": condition,
        "purchase_price": purchase_price, "sticker_price": sticker_price,
        "date_bought": str(date_bought), "is_bulk_deal": bulk_int, "is_sold": 0,
        "custom_image_data": custom_image_data, "sold_price": 0.0, "date_sold": "",
        "is_deleted": 0, "updated_at": now_ts
    })
    save_local_inventory(local_inv)

def mark_inventory_sold(item_ids: List[str], sold_price_per_item: float, date_sold: str):
    if not item_ids: return
    now_ts = time.time()
    beta_key = get_beta_key()
    local_inv = load_local_inventory()
    
    for item_id in item_ids:
        add_pending_sync(
            "UPDATE inventory SET is_sold = 1, sold_price = ?, date_sold = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            [float(sold_price_per_item), str(date_sold), now_ts, str(item_id), beta_key]
        )
        for item in local_inv:
            if str(item.get("id")) == str(item_id):
                item["is_sold"], item["sold_price"], item["date_sold"], item["updated_at"] = 1, float(sold_price_per_item), str(date_sold), now_ts
    save_local_inventory(local_inv)

def undo_inventory_sale(item_id: str):
    now_ts = time.time()
    beta_key = get_beta_key()
    add_pending_sync("UPDATE inventory SET is_sold = 0, sold_price = 0.0, date_sold = '', updated_at = ? WHERE id = ? AND user_id = ?", [now_ts, str(item_id), beta_key])
    local_inv = load_local_inventory()
    for item in local_inv:
        if str(item.get("id")) == str(item_id):
            item["is_sold"], item["sold_price"], item["date_sold"], item["updated_at"] = 0, 0.0, "", now_ts
    save_local_inventory(local_inv)

def update_inventory_bulk(edited_rows):
    if not edited_rows:
        return
    now_ts = time.time()
    beta_key = get_beta_key()
    local_inv = load_local_inventory()
    for row in edited_rows:
        if not isinstance(row, dict):
            continue
        row_id = str(row.get("ID", ""))
        if not row_id:
            continue
        condition = str(row.get("Condition", "Near Mint"))
        paid = float(row.get("Paid ($)", 0.0) or 0.0)
        sticker = float(row.get("Sticker ($)", 0.0) or 0.0)
        bulk_int = 1 if row.get("Bulk Deal") else 0
        date_bought = str(row.get("Date", ""))
        add_pending_sync(
            "UPDATE inventory SET condition = ?, purchase_price = ?, sticker_price = ?, is_bulk_deal = ?, date_bought = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            [condition, paid, sticker, bulk_int, date_bought, now_ts, row_id, beta_key]
        )
        for item in local_inv:
            if str(item.get("id")) == row_id:
                item["condition"] = condition
                item["purchase_price"] = paid
                item["sticker_price"] = sticker
                item["is_bulk_deal"] = bulk_int
                item["date_bought"] = date_bought
                item["updated_at"] = now_ts
    save_local_inventory(local_inv)

def update_inventory_item_full(item_id: str, product_id: int, card_name: str, card_number: str, set_name: str, variant: str, condition: str, purchase_price: float, sticker_price: float, date_bought: str, custom_image_data: str = None):
    now_ts = time.time()
    beta_key = get_beta_key()
    add_pending_sync(
        "UPDATE inventory SET product_id = ?, card_name = ?, card_number = ?, set_name = ?, variant = ?, condition = ?, purchase_price = ?, sticker_price = ?, date_bought = ?, custom_image_data = ?, updated_at = ? WHERE id = ? AND user_id = ?", 
        [product_id, card_name, card_number, set_name, variant, condition, purchase_price, sticker_price, str(date_bought), custom_image_data, now_ts, str(item_id), beta_key]
    )
    local_inv = load_local_inventory()
    for item in local_inv:
        if str(item.get("id")) == str(item_id):
            item["product_id"], item["card_name"], item["card_number"], item["set_name"], item["variant"], item["condition"], item["purchase_price"], item["sticker_price"], item["date_bought"], item["custom_image_data"], item["updated_at"] = product_id, card_name, card_number, set_name, variant, condition, purchase_price, sticker_price, str(date_bought), custom_image_data, now_ts
    save_local_inventory(local_inv)

def delete_inventory_items_bulk(item_ids: List[str]):
    if not item_ids: return
    now_ts = time.time()
    beta_key = get_beta_key()
    local_inv = load_local_inventory()
    
    for item_id in item_ids:
        add_pending_sync("UPDATE inventory SET is_deleted = 1, updated_at = ? WHERE id = ? AND user_id = ?", [now_ts, str(item_id), beta_key])
        local_inv = [i for i in local_inv if str(i.get("id")) != str(item_id)]
    save_local_inventory(local_inv)

def update_sticker_prices_bulk(updates: List[Tuple[float, str]]):
    if not updates: return
    now_ts = time.time()
    beta_key = get_beta_key()
    local_inv = load_local_inventory()
    for new_sticker, item_id in updates:
        add_pending_sync("UPDATE inventory SET sticker_price = ?, updated_at = ? WHERE id = ? AND user_id = ?", [float(new_sticker), now_ts, str(item_id), beta_key])
        for item in local_inv:
            if str(item.get("id")) == str(item_id):
                item["sticker_price"], item["updated_at"] = float(new_sticker), now_ts
    save_local_inventory(local_inv)

def merge_cloud_inventory(remote_items: List[Dict[str, Any]]):
    local_inv = load_local_inventory()
    local_map = {str(item["id"]): item for item in local_inv}
    beta_key = get_beta_key()
    
    for r in remote_items:
        if r.get("user_id") and r.get("user_id") != beta_key:
            continue
        r_id = str(r["id"])
        r_updated = float(r.get("updated_at", 0.0))
        r_deleted = int(r.get("is_deleted", 0))
        
        if r_id in local_map:
            l_updated = float(local_map[r_id].get("updated_at", 0.0))
            if r_updated >= l_updated:
                if r_deleted == 1:
                    del local_map[r_id]
                else:
                    local_map[r_id] = r
        else:
            if r_deleted == 0:
                local_map[r_id] = r

    merged = sorted(list(local_map.values()), key=lambda x: x.get("updated_at", 0.0), reverse=True)
    save_local_inventory(merged)

# --- CONFIG AND LOCAL DB SEARCH ---
def get_vendor_settings(user_id: str = "default_vendor") -> dict:
    data = _hard_load(_scoped_storage_key("pokequant_vendor_settings")) if IS_BROWSER else None
    
    if data and isinstance(data, str):
        try:
            data = json.loads(data)
        except Exception:
            pass

    scoped_path = _scoped_local_path("local_settings")
    if not data and os.path.exists(scoped_path):
        try:
            with open(scoped_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            pass

    if not data and os.path.exists("local_settings.json"):
        try:
            with open("local_settings.json", "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            pass
            
    return data if data else DEFAULT_SETTINGS

def save_vendor_settings(settings: dict, user_id: str = "default_vendor"):
    if IS_BROWSER: 
        _hard_save(_scoped_storage_key("pokequant_vendor_settings"), settings)
        
    scoped_path = _scoped_local_path("local_settings")
    try:
        with open(scoped_path, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2)
    except Exception:
        pass
        
    now_ts = time.time()
    beta_key = get_beta_key()
    add_pending_sync("INSERT OR REPLACE INTO vendor_settings (user_id, settings_json, updated_at) VALUES (?, ?, ?)", [beta_key, json.dumps(settings), now_ts])

def get_last_updated_date() -> str:
    if not os.path.exists(DB_NAME):
        return "N/A"
    try:
        conn = sqlite3.connect(DB_NAME, timeout=5)
        cursor = conn.cursor()
        cursor.execute("SELECT date FROM price_history ORDER BY date DESC, rowid DESC LIMIT 1")
        res = cursor.fetchone()
        conn.close()
        
        if res and res[0]:
            raw_date = str(res[0]).strip()
            clean_date = raw_date.replace("T", " ").split(".")[0]
            try:
                if " " in clean_date:
                    return datetime.strptime(clean_date, "%Y-%m-%d %H:%M:%S").strftime("%b %d, %Y %I:%M %p")
                else:
                    return datetime.strptime(clean_date, "%Y-%m-%d").strftime("%b %d, %Y")
            except Exception:
                return raw_date
        return "N/A"
    except Exception:
        return "N/A"

def calculate_buy_offer(market_price: float, buy_tiers: list = None) -> Dict[str, Any]:
    if buy_tiers is None: 
        buy_tiers = DEFAULT_SETTINGS["buy_tiers"]
    if market_price is None or market_price <= 0: 
        return {"buy_rate_pct": 0, "cash_offer": 0.0}
    rate = 60
    for tier in buy_tiers:
        if tier["min"] <= market_price < tier["max"]:
            rate = tier["rate"]
            break
    return {"buy_rate_pct": int(rate), "cash_offer": round(market_price * (rate / 100.0), 2)}

def search_cards_paginated(query: str = "", rarity: str = "All", max_price: float = 0.0, product_type: str = "All", sort_by: str = "Newest", page: int = 1, page_size: int = 20, buy_tiers: list = None) -> Tuple[List[Dict[str, Any]], int, int]:
    """Search the offline catalog with filters, returning a paginated list of cards and live pricing.

    The card list comes from SQL; all price-history/trend analysis for the page is
    computed from a single batched query to avoid the previous N+1 per-card round-trips.
    """
    if not os.path.exists(DB_NAME):
        return [], 1, 0

    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    sql_from = "FROM cards c WHERE 1=1"
    params = []

    if query:
        for word in query.split():
            clean_word = word.replace("'", "").replace("-", "").replace(".", "")
            sql_from += " AND (REPLACE(REPLACE(REPLACE(c.card_name, '''', ''), '-', ''), '.', '') LIKE ? OR REPLACE(c.card_number, '-', '') LIKE ? OR REPLACE(REPLACE(REPLACE(c.set_name, '''', ''), '-', ''), '.', '') LIKE ?)"
            params.extend([f"%{clean_word}%", f"%{clean_word}%", f"%{clean_word}%"])

    if rarity and rarity != "All":
        sql_from += " AND c.rarity = ?"
        params.append(rarity)

    if product_type == "Cards Only":
        sql_from += " AND c.card_number != 'N/A'"
    elif product_type == "Sealed Only":
        sql_from += " AND c.card_number = 'N/A'"

    if max_price > 0:
        sql_from += " AND EXISTS (SELECT 1 FROM price_history p1 WHERE p1.product_id = c.product_id AND p1.market_price <= ? AND p1.date = (SELECT MAX(p2.date) FROM price_history p2 WHERE p2.product_id = p1.product_id AND p2.sub_type = p1.sub_type))"
        params.append(max_price)

    cursor.execute(f"SELECT COUNT(*) {sql_from}", params)
    total_cards = cursor.fetchone()[0]
    total_pages = max(1, (total_cards + page_size - 1) // page_size)

    order_params = []
    if sort_by == "Oldest":
        order_clause = "ORDER BY c.product_id ASC"
    elif sort_by == "Price: High to Low":
        if max_price > 0:
            order_clause = "ORDER BY (SELECT MAX(p.market_price) FROM price_history p WHERE p.product_id = c.product_id AND p.market_price <= ? AND p.date = (SELECT MAX(date) FROM price_history WHERE product_id = c.product_id)) DESC NULLS LAST"
            order_params.append(max_price)
        else:
            order_clause = "ORDER BY (SELECT MAX(p.market_price) FROM price_history p WHERE p.product_id = c.product_id AND p.date = (SELECT MAX(date) FROM price_history WHERE product_id = c.product_id)) DESC NULLS LAST"
    elif sort_by == "Price: Low to High":
        if max_price > 0:
            order_clause = "ORDER BY (SELECT MIN(p.market_price) FROM price_history p WHERE p.product_id = c.product_id AND p.market_price <= ? AND p.date = (SELECT MAX(date) FROM price_history WHERE product_id = c.product_id)) ASC NULLS LAST"
            order_params.append(max_price)
        else:
            order_clause = "ORDER BY (SELECT MIN(p.market_price) FROM price_history p WHERE p.product_id = c.product_id AND p.date = (SELECT MAX(date) FROM price_history WHERE product_id = c.product_id)) ASC NULLS LAST"
    else:
        order_clause = "ORDER BY c.product_id DESC"

    cursor.execute("PRAGMA table_info(cards)")
    columns = [info[1] for info in cursor.fetchall()]
    has_img = 'image_base64' in columns

    offset = (page - 1) * page_size
    query_sql = f"SELECT c.product_id, c.card_name, c.card_number, c.set_name, c.image_base64 {sql_from} {order_clause} LIMIT ? OFFSET ?" if has_img else f"SELECT c.product_id, c.card_name, c.card_number, c.set_name {sql_from} {order_clause} LIMIT ? OFFSET ?"

    cursor.execute(query_sql, params + order_params + [page_size, offset])
    matched_cards = cursor.fetchall()
    results = []

    # Single batched price-history fetch for every card on this page.
    product_ids = [int(row[0]) for row in matched_cards if row[0]]
    price_map = _get_price_map(cursor, product_ids)

    for row in matched_cards:
        product_id, name, number, c_set = int(row[0]), row[1], row[2], row[3]
        img_b64 = row[4] if has_img else None
        variants_data = []

        for stype, hist in price_map.get(product_id, {}).items():
            analysis = _analyze_variant_history(hist, buy_tiers, max_price if max_price > 0 else None)
            if not analysis:
                continue
            variants_data.append({
                "variant": stype,
                "market_price": analysis["market_price"],
                "buy_percentage": f"{analysis['buy_rate_pct']}%",
                "cash_offer": analysis["cash_offer"],
                "1d_trend": analysis["trends"][1],
                "3d_trend": analysis["trends"][3],
                "7d_trend": analysis["trends"][7],
                "30d_trend": analysis["trends"][30],
                "90d_trend": analysis["trends"][90],
                "90d_high": analysis["90d_high"],
                "90d_low": analysis["90d_low"],
                "last_updated": analysis["last_updated"]
            })

        if variants_data:
            results.append({"product_id": product_id, "card_name": name, "card_number": number, "set": c_set, "pricing": variants_data, "image_base64": img_b64})

    conn.close()
    return results, total_pages, total_cards

def search_card_and_pricing(query: str, limit: int = 1, buy_tiers: list = None) -> List[Dict[str, Any]]:
    results, _, _ = search_cards_paginated(query=query, page_size=limit, buy_tiers=buy_tiers)
    return results