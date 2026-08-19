#!/usr/bin/env python3
"""Build the three Careerpin PostHog dashboards from insight-payloads.json (WIC-1024).

Turns `docs/analytics/dashboard-spec.md` v1.0 into live PostHog objects: 3 dashboards
(A - Upload Health, B - Export & Engagement, C - Retention & Repeat Usage) and the
17 insights A1-A9 / B1-B5 / C1-C3 attached to them.

Idempotent: dashboards and insights are matched by exact name, so a re-run updates
in place rather than creating duplicates. Safe to run repeatedly.

Usage
-----
    export POSTHOG_PERSONAL_API_KEY=phx_...
    python3 docs/analytics/build_dashboards.py --dry-run   # validate only, no writes
    python3 docs/analytics/build_dashboards.py             # create/update for real

--dry-run needs only read scope (`query:read`) and re-executes every HogQL query
against the live project, so it proves the payloads before anything is written.
The real run additionally needs `insight:read`, `insight:write`, `dashboard:read`,
`dashboard:write` on project 551963.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import requests

HOST = os.environ.get("POSTHOG_HOST", "https://us.posthog.com").rstrip("/")
PROJECT_ID = os.environ.get("POSTHOG_PROJECT_ID", "551963")
PAYLOADS = Path(__file__).with_name("insight-payloads.json")

# Descriptions for the three dashboards, keyed by the `_dashboard` field in the payloads.
DASHBOARD_DESCRIPTIONS = {
    "Dashboard A — Upload Health": (
        "Resume upload pipeline health: success rate, validation errors, funnel, "
        "processing time and parse quality. Spec: docs/analytics/dashboard-spec.md (A1-A9)."
    ),
    "Dashboard B — Export & Engagement": (
        "What users do after a successful upload: export views, resume manager visits, "
        "CTA split and export generation. Spec: docs/analytics/dashboard-spec.md (B1-B5)."
    ),
    "Dashboard C — Retention & Repeat Usage": (
        "Do uploaders come back: 30d return rate, uploads per active user, new vs "
        "returning cohorts. Spec: docs/analytics/dashboard-spec.md (C1-C3)."
    ),
}


class PostHog:
    def __init__(self, api_key: str) -> None:
        self.session = requests.Session()
        self.session.headers.update(
            {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        )

    def _url(self, path: str) -> str:
        return f"{HOST}/api/projects/{PROJECT_ID}/{path.lstrip('/')}"

    def request(self, method: str, path: str, **kwargs) -> requests.Response:
        return self.session.request(method, self._url(path), timeout=60, **kwargs)

    def list_all(self, path: str, params: dict | None = None) -> list[dict]:
        """Follow PostHog's cursor pagination and return every result."""
        out: list[dict] = []
        url = self._url(path)
        params = {"limit": 100, **(params or {})}
        while url:
            resp = self.session.get(url, params=params, timeout=60)
            resp.raise_for_status()
            body = resp.json()
            out.extend(body.get("results", []))
            url = body.get("next")
            params = None  # `next` is already fully-qualified
        return out


def fail(msg: str) -> None:
    print(f"FAIL  {msg}", file=sys.stderr)
    sys.exit(1)


def preflight(ph: PostHog, need_write: bool) -> None:
    """Check scopes up front and name the exact missing ones rather than dying mid-loop."""
    checks = [("query", "query/", "POST")]
    if need_write:
        checks += [("insight", "insights/?limit=1", "GET"), ("dashboard", "dashboards/?limit=1", "GET")]

    missing = []
    for name, path, method in checks:
        if method == "POST":
            resp = ph.request("POST", path, json={"query": {"kind": "HogQLQuery", "query": "SELECT 1"}})
        else:
            resp = ph.request("GET", path)
        if resp.status_code == 403:
            missing.append(f"{name}: {resp.json().get('detail', resp.text)}")
        elif not resp.ok:
            fail(f"preflight {method} {path} -> {resp.status_code} {resp.text[:300]}")

    if missing:
        print("FAIL  PostHog personal API key is missing required scopes:", file=sys.stderr)
        for m in missing:
            print(f"        - {m}", file=sys.stderr)
        print(
            "\n      Fix: PostHog > Settings > Personal API keys > edit the Careerpin analytics key,\n"
            f"      add insight:read, insight:write, dashboard:read, dashboard:write on project {PROJECT_ID}.",
            file=sys.stderr,
        )
        sys.exit(2)
    print(f"OK    scopes present ({'read+write' if need_write else 'read'})")


def run_query(ph: PostHog, hogql: str) -> tuple[bool, str]:
    resp = ph.request("POST", "query/", json={"query": {"kind": "HogQLQuery", "query": hogql}})
    if not resp.ok:
        return False, f"HTTP {resp.status_code}: {resp.text[:300]}"
    body = resp.json()
    rows = body.get("results", [])
    return True, f"{len(rows)} row(s): {rows[:1]}"


def ensure_dashboard(ph: PostHog, name: str) -> int:
    existing = {d["name"]: d for d in ph.list_all("dashboards/") if not d.get("deleted")}
    if name in existing:
        dash = existing[name]
        print(f"SKIP  dashboard exists: {name} (id={dash['id']})")
        return dash["id"]
    resp = ph.request(
        "POST",
        "dashboards/",
        json={"name": name, "description": DASHBOARD_DESCRIPTIONS.get(name, ""), "pinned": True},
    )
    if not resp.ok:
        fail(f"create dashboard {name!r} -> {resp.status_code} {resp.text[:300]}")
    dash_id = resp.json()["id"]
    print(f"CREATE dashboard: {name} (id={dash_id})")
    return dash_id


def ensure_insight(ph: PostHog, payload: dict, dashboard_id: int, existing: dict[str, dict]) -> None:
    """Create the insight, or update it in place if one with the same name already exists."""
    body = {k: v for k, v in payload.items() if not k.startswith("_")}
    body["dashboards"] = [dashboard_id]

    current = existing.get(body["name"])
    if current:
        resp = ph.request("PATCH", f"insights/{current['id']}/", json=body)
        verb = "UPDATE"
    else:
        resp = ph.request("POST", "insights/", json=body)
        verb = "CREATE"
    if not resp.ok:
        fail(f"{verb.lower()} insight {body['name']!r} -> {resp.status_code} {resp.text[:300]}")
    print(f"{verb} insight: {body['name']} (id={resp.json()['id']})")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="validate payloads and re-execute every HogQL query; write nothing",
    )
    args = parser.parse_args()

    api_key = os.environ.get("POSTHOG_PERSONAL_API_KEY")
    if not api_key:
        fail("POSTHOG_PERSONAL_API_KEY is not set")

    payloads = json.loads(PAYLOADS.read_text())
    print(f"Loaded {len(payloads)} insight payloads from {PAYLOADS.name}")

    ph = PostHog(api_key)
    preflight(ph, need_write=not args.dry_run)

    if args.dry_run:
        failures = 0
        for p in payloads:
            hogql = p["query"]["source"]["query"]
            ok, detail = run_query(ph, hogql)
            print(f"{'PASS' if ok else 'FAIL'}  {p['_key']:<32} {detail}")
            failures += 0 if ok else 1
        by_dash: dict[str, int] = {}
        for p in payloads:
            by_dash[p["_dashboard"]] = by_dash.get(p["_dashboard"], 0) + 1
        print("\nWould create/update:")
        for name, count in by_dash.items():
            print(f"  - {name}: {count} insights")
        print(f"\n{len(payloads) - failures}/{len(payloads)} queries executed green.")
        return 1 if failures else 0

    existing_insights = {i["name"]: i for i in ph.list_all("insights/", {"saved": "true"}) if not i.get("deleted")}
    dashboard_ids: dict[str, int] = {}
    for p in payloads:
        name = p["_dashboard"]
        if name not in dashboard_ids:
            dashboard_ids[name] = ensure_dashboard(ph, name)
        ensure_insight(ph, p, dashboard_ids[name], existing_insights)

    print(f"\nDone. {len(dashboard_ids)} dashboards, {len(payloads)} insights.")
    for name, dash_id in dashboard_ids.items():
        print(f"  {name}: {HOST}/project/{PROJECT_ID}/dashboard/{dash_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
