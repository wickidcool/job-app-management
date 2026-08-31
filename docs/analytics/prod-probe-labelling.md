# Labelling synthetic traffic in PostHog project 551963 (production)

**Status:** convention, in force from 2026-08-26. Owner: DevOps.
**Source of record:** WIC-1389 (raised by the Data Analyst) / WIC-1358 (organic-traffic watcher) / WIC-1024 (dashboard build, held on the first organic session).

Project **551963 is production analytics.** WIC-1024 — a human console session building three
dashboards — is released on exactly one condition: **the first organic session.** Any synthetic
event that cannot be identified as synthetic is a candidate first-organic-session, and releasing
that hold on a probe costs a human afternoon building dashboards over fake data.

So: **every event this org sends to 551963 must be attributable to a ticket by machine, with no
human adjudication.** This document says how, and — more importantly — records which markers each
kind of probe is actually *able* to set.

## The mechanism (read this before writing the rule off as obvious)

`packages/api/src/services/analytics.service.ts:131` resolves the actor:

```js
distinct_id: event.userId ?? event.sessionId ?? 'anonymous',
```

and `session_id` reaches the server from the `x-session-id` request header
(`packages/api/src/routes/resumes.ts:52`). The event *name* comes from the WIC-814 server taxonomy
and is chosen by product code, not by the caller.

That produces **two probe classes with very different labelling power**:

| | Class A — capture-level probe | Class B — end-to-end probe |
|---|---|---|
| What it does | `POST` straight to PostHog `/capture/` | real HTTP request to prod `careerpin.app/api/*` |
| Event name | **caller's choice** → use a `qa_` prefix | **fixed by server taxonomy** — cannot be `qa_` |
| `distinct_id` | **caller's choice** → use `qa-`/`probe-`/`smoke-` | **`userId` when authenticated** — an opaque Supabase UUID, unprefixable |
| `session_id` | **caller's choice** | **caller's choice**, via the `x-session-id` header |
| `$lib` | caller's choice | `wic-api` (server) / `wic-web` (browser) |
| Proves | the analytics sink is wired | the *product* works end to end |

**A Class B probe controls exactly one of the three markers: `session_id`.** This is why the
WIC-967 probe landed in 551963 with a real taxonomy event name and a bare-UUID `distinct_id` and
was, on actor fingerprint alone, indistinguishable from the first real user. It was not sloppiness
and it is not fixable by trying harder — an authenticated request *is* attributed to its
authenticated user, by design (WIC-822). The three probes before it all looked well-labelled
because all three were Class A.

## The rule

### Class A — capture-level probes

Set **all three** markers. They are free:

- event name prefixed `qa_`
- `distinct_id` prefixed `qa-` / `probe-` / `smoke-`
- `session_id` prefixed `wic<ticket>-`

### Class B — end-to-end probes

1. **MUST** send `x-session-id: wic<ticket>-<epoch>` on every request in the probe.
   This is the only in-band marker available, so it is mandatory, not best-effort.
2. **MUST** register the probe's actor in `docs/analytics/probe-registry.json` **before the
   first request is sent** — the auth user id is known at signup time, so there is no excuse for
   registering it after the fact.
3. **SHOULD** use a plus-addressed owner account, `al+wic<ticket>@wickidcool.com`, so the account
   itself names its ticket even where the UUID does not.

Registration is what closes the hole that the prefix convention cannot: it turns an unprefixable
opaque UUID into an **exact-match exclusion key** that the watcher can join on.

## The registry

`docs/analytics/probe-registry.json` is the machine-readable list of every known synthetic actor.
It is version-controlled deliberately — the watcher's quarantine set should not be the only copy of
this knowledge, and a workspace reset must not be able to destroy it.

Consume it as an exclusion clause. Both keys, because Class A probes have no `session_id` and
Class B probes have no usable `distinct_id`:

```sql
-- exclude every registered synthetic actor
where distinct_id not in (<registry distinct_ids>)
  and not match(toString(properties.session_id), '^wic[0-9]+-')
  and not startsWith(event, 'qa_')
  and not match(distinct_id, '^(qa|probe|smoke)-')
```

Keep the prefix predicates *as well as* the registry: the registry catches what the prefixes
cannot, and the prefixes catch a probe someone forgot to register.

## Known synthetic actors as of 2026-08-26

All 6 lifetime events in 551963, verified by HogQL this heartbeat. There are **zero organic
events**, lifetime.

| When | Ticket | Class | Event(s) | `distinct_id` | `session_id` |
|---|---|---|---|---|---|
| 2026-08-11 | WIC-889 | A | `qa_acceptance_probe_wic889` | `qa-wic889-probe` | *(none)* |
| 2026-08-18 | WIC-996 | A | `resume_upload_{submitted,completed,failed}` | `smoke-wic996-user-064d2fae-…` | `smoke-wic996-064d2fae-…` |
| 2026-08-19 | *(none)* | A | `qa_client_capture_probe_20260819` | `probe-20260819-clientpath` | `probe-20260819-clientpath` |
| 2026-08-26 | WIC-967 | **B** | `resume_upload_submitted` | `fa21d5a4-…` **(unprefixable)** | `wic967-devops-1787717978` |

Note that WIC-996 emitted all three upload legs 0.3 s apart — including `completed` *and* `failed`
for one session, which no real upload can do. That is the fingerprint of a Class A probe and is
further reason not to read the funnel without excluding the registry.

## Why the WIC-967 probe left a dangling funnel leg

Recorded here because the obvious reading — "the harness only fires the first leg" — is wrong, and
the true cause changes how the funnel must be read.

The WIC-967 probe was a **complete** end-to-end upload: a real authenticated
`POST /api/resumes/upload` against production. It exercised the whole path. The path 500ed, and
the terminal event was emitted by the code and then **dropped by the runtime**:

- **WIC-1386** — prod exhausts its Worker subrequest budget in `connect(cloudflare:sockets)`, so
  every authenticated endpoint 500s.
- **WIC-1387** — `track()` delivers over `fetch()`, and *a `fetch` is a subrequest*. The `catch` in
  `resume.service.ts:755` does call `track('resume_upload_failed', …)`, but by then the budget is
  gone; the capture throws and `createPostHogSink` swallows it
  (`analytics.service.ts:142`) because analytics must never break the request path.
  `resume_upload_submitted` survives only because it fires *before* any DB work
  (`resume.service.ts:450`).

**Consequence for every dashboard built on this data:** failure telemetry is lost in proportion to
how badly the system is failing. A panel that counts `resume_upload_failed` reads **zero during a
total outage** — indistinguishable from perfect health, biased toward false calm.

> **Derive failures from `submitted` with no matching terminal event. Never from counting
> `resume_upload_failed`.**

And read a dangling `submitted` leg as **evidence of an outage**, not as evidence of a half-built
probe.

## Running an end-to-end probe

Use `docs/analytics/prod_probe.sh`, which refuses to run without a ticket number and stamps the
session header for you. See `--help`.
