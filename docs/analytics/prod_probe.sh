#!/usr/bin/env bash
# End-to-end production probe wrapper (WIC-1389).
#
# A Class B probe — a real authenticated request against production — controls exactly ONE
# analytics marker: `session_id`, via the `x-session-id` header. The event name comes from the
# server taxonomy and `distinct_id` is the Supabase auth user id (analytics.service.ts:131), so
# neither can be prefixed. This wrapper makes the one available marker mandatory instead of
# incidental, and refuses to fire until the unprefixable actor is registered as synthetic.
#
# See docs/analytics/prod-probe-labelling.md.
set -euo pipefail

REGISTRY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/probe-registry.json"
BASE_URL="${PROBE_BASE_URL:-https://careerpin.app}"

usage() {
  cat <<'EOF'
Usage: prod_probe.sh --ticket <NNN> --user-id <uuid> [options] -- <curl args...>

Required:
  --ticket NNN        Ticket number, digits only (e.g. 967). Becomes session_id `wicNNN-<epoch>`.
  --user-id UUID      The probe's Supabase auth user id. This is the value that will land in
                      PostHog as `distinct_id`; it must already appear in probe-registry.json.

Options:
  --token JWT         Bearer token for the authenticated request.
  --path PATH         API path to hit (default: /api/resumes/upload).
  --dry-run           Print the request and the analytics labels it will produce; send nothing.
  --allow-unregistered
                      Proceed even if --user-id is absent from the registry. Use only for an
                      anonymous (unauthenticated) probe, where distinct_id falls back to
                      session_id and is therefore already labelled.
  -h, --help          This text.

Exit codes:
  0  ok           2  missing/!invalid --ticket        3  actor not in probe-registry.json
EOF
}

TICKET="" USER_ID="" TOKEN="" API_PATH="/api/resumes/upload" DRY_RUN=0 ALLOW_UNREG=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ticket) TICKET="${2:-}"; shift 2 ;;
    --user-id) USER_ID="${2:-}"; shift 2 ;;
    --token) TOKEN="${2:-}"; shift 2 ;;
    --path) API_PATH="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --allow-unregistered) ALLOW_UNREG=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    *) echo "prod_probe.sh: unknown argument '$1'" >&2; usage >&2; exit 2 ;;
  esac
done

# Gate 1 — the session marker is not optional. An unlabelled probe into project 551963 is a
# candidate first-organic-session and can falsely release the WIC-1024 hold.
if [[ ! "$TICKET" =~ ^[0-9]+$ ]]; then
  echo "prod_probe.sh: --ticket is required and must be digits only." >&2
  echo "  Every event this probe emits into PROD PostHog 551963 must name its ticket." >&2
  exit 2
fi
SESSION_ID="wic${TICKET}-$(date +%s)"

# Gate 2 — an authenticated probe's distinct_id is the auth user id and cannot be prefixed, so
# the only way it is ever identifiable as synthetic is by being registered BEFORE it is used.
if [[ -n "$USER_ID" && "$ALLOW_UNREG" -eq 0 ]]; then
  if ! grep -qF "$USER_ID" "$REGISTRY"; then
    echo "prod_probe.sh: auth user '$USER_ID' is not in probe-registry.json." >&2
    echo "  Its distinct_id cannot carry a qa-/probe-/smoke- prefix, so registering it is the" >&2
    echo "  only thing that will ever mark this traffic synthetic. Add it, commit, re-run." >&2
    echo "  Registry: $REGISTRY" >&2
    exit 3
  fi
fi

echo "probe ticket      WIC-${TICKET}"
echo "probe session_id  ${SESSION_ID}      <- lands as properties.session_id, matches '^wic[0-9]+-'"
echo "probe distinct_id ${USER_ID:-<anonymous: falls back to session_id>}"
echo "probe target      ${BASE_URL}${API_PATH}"

# Build the command as an array. A `${TOKEN:+-H "Authorization: Bearer $TOKEN"}` expansion would
# word-split into four arguments and send a malformed header, so do not "simplify" this.
cmd=(curl -sS -X POST "${BASE_URL}${API_PATH}" -H "x-session-id: ${SESSION_ID}")
if [[ -n "$TOKEN" ]]; then
  cmd+=(-H "Authorization: Bearer ${TOKEN}")
fi
cmd+=("$@")

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "DRY RUN — not sent:"
  printf ' %q' "${cmd[@]}"; echo
  exit 0
fi

"${cmd[@]}"
