"""
AmzCentric OS - fingerprint machine bridge.

Reads punches from the office ZKTeco machine (e.g. K50) over the office network and sends
them to AmzCentric OS. Run it on any PC in the office every few minutes (Windows Task
Scheduler); it only sends what's new, and re-sending is harmless.

Setup: see README.md in this folder. Needs Python 3.9+ and `pip install pyzk`.
Usage:
    python zk_bridge.py              # send new punches
    python zk_bridge.py --days 90    # first run: also send the last 90 days
    python zk_bridge.py --dry-run    # read the machine and print, send nothing
"""

import argparse
import configparser
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(HERE, "last_sent.txt")
BATCH = 2000


def load_config(path):
    cfg = configparser.ConfigParser()
    if not cfg.read(path):
        sys.exit(f"Config not found: {path}. Copy bridge.example.ini to bridge.ini and fill it in.")
    return {
        "ip": cfg.get("device", "ip"),
        "port": cfg.getint("device", "port", fallback=4370),
        "password": cfg.getint("device", "password", fallback=0),
        "name": cfg.get("device", "name", fallback="K50"),
        "url": cfg.get("app", "url", fallback="https://os.amzcentric.com").rstrip("/"),
        "token": cfg.get("app", "token"),
    }


def read_machine(c):
    from zk import ZK  # pyzk

    zk = ZK(c["ip"], port=c["port"], timeout=15, password=c["password"], force_udp=False, ommit_ping=True)
    conn = zk.connect()
    try:
        users = conn.get_users() or []
        punches = conn.get_attendance() or []
    finally:
        conn.disconnect()
    return users, punches


def last_sent():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return dt.datetime.strptime(f.read().strip(), "%Y-%m-%d %H:%M:%S")
    except (FileNotFoundError, ValueError):
        return None


def save_last_sent(ts):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        f.write(ts.strftime("%Y-%m-%d %H:%M:%S"))


def post(c, body):
    req = urllib.request.Request(
        f"{c['url']}/api/hr/punches",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {c['token']}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        sys.exit(f"AmzCentric OS refused the punches: HTTP {e.code} {detail}")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Send fingerprint punches to AmzCentric OS.")
    ap.add_argument("--config", default=os.path.join(HERE, "bridge.ini"))
    ap.add_argument("--days", type=int, default=None, help="send punches from the last N days (default: since the last run, or 35 days on the first run)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    c = load_config(args.config)

    users, punches = read_machine(c)
    since = last_sent()
    if args.days is not None or since is None:
        since = dt.datetime.now() - dt.timedelta(days=args.days or 35)
    else:
        since = since - dt.timedelta(hours=1)  # small overlap; duplicates are ignored by the app

    new = sorted((p for p in punches if p.timestamp >= since), key=lambda p: p.timestamp)
    rows = [{"user_id": str(p.user_id), "time": p.timestamp.strftime("%Y-%m-%d %H:%M:%S")} for p in new]
    people = [{"user_id": str(u.user_id), "name": (u.name or "").strip()} for u in users]
    print(f"Machine: {len(users)} users, {len(punches)} punches stored; {len(rows)} since {since:%Y-%m-%d %H:%M}.")
    if args.dry_run:
        for r in rows[-20:]:
            print("  ", r["user_id"], r["time"])
        return 0

    added = 0
    for i in range(0, max(len(rows), 1), BATCH):
        res = post(c, {"device": c["name"], "punches": rows[i : i + BATCH], "users": people if i == 0 else []})
        added += res.get("added", 0)
        if res.get("invalid"):
            print(f"  {res['invalid']} punches were rejected as invalid.")
    if new:
        save_last_sent(new[-1].timestamp)
    print(f"Sent. {added} new punches saved in AmzCentric OS.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
