#!/usr/bin/env python3
"""Bygger den frittstående prototypen (én HTML-fil med data) fra head.html, body.html og app.json.

Bruk:
    python3 prototype/build.py [--data app.json] [--out politiloggen-analyse.html]

app.json lages med scripts/build_app_data.py.
"""

import argparse
from pathlib import Path

HERE = Path(__file__).parent


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default="app.json")
    ap.add_argument("--out", default="politiloggen-analyse.html")
    args = ap.parse_args()
    page = (HERE / "head.html").read_text(encoding="utf-8") + (HERE / "body.html").read_text(encoding="utf-8")
    data = Path(args.data).read_text(encoding="utf-8").replace("</", "<\\/")  # kan ikke avslutte <script>
    Path(args.out).write_text(page.replace("/*__DATA__*/null", data, 1), encoding="utf-8")
    print(f"Skrev {args.out}")


if __name__ == "__main__":
    main()
