# ADR-010: Absent-owner posture — an authenticated request with no owner reads nothing

## Status

**Accepted** (2026-09-05) — supersedes the owner-absent affordance in
[ADR-003: Multi-User Authentication with Supabase](./ADR-003-multi-user-auth.md).

The posture is adopted and is being implemented; acceptance records the decision, not
completion of the burndown. See **Implementation status** below for what has actually landed.

Tracking: WIC-1600. Per-site remediation: WIC-1549, WIC-1554, WIC-1596, WIC-1435 — all merged.
Analysis of record: WIC-1430 document `tenancy-absent-caller-audit`.

## Implementation status

Re-measured on `main` at `e50ec066` (2026-09-06). Recorded here so the next reader does not
re-derive it — four separate cards have now re-measured this independently, which is itself
the reason to keep this table current rather than pinned to the commit that first filled it in.

**Every count below is a measurement at a named commit, not a standing quantity.** The D2 row
in particular was stale by a factor of four for a day, and a stale count here does not merely
misinform — it reads as a backlog and invites duplicate remediation. If you re-measure, update
the row and its commit together, or say nothing.

| decision | state | evidence |
|---|---|---|
| **D1.1** reject a token that verifies with no `sub` | ✅ landed | `middleware/auth.ts` `requireSubject` throws → 401 on both the ES256/RS256 and HS256 paths |
| **D1.2** narrow `HonoVariables.userId` to `string` | ✅ landed | `src/types/env.ts` is `userId: string`; `PUBLIC_PATHS` now leaves the variable unset rather than setting `null` |
| **D1.3** delete the `c.get('userId') ?? undefined` laundering at every route | ✅ landed — **0 sites** | was 66 across 11 route files; `requireOwner(c)` adoptions **77**, in all 11 route files |
| **D2** service signatures take `userId: string` | ✅ agent-dispatchable burndown complete; **24 sites remain, none agent-actionable** | the guard reports `[SIG] 21`, `[COND] 3` at `e50ec066` (was 71/29 at `a64554a8`, 81/42 before that). Five slices closed the gap: WIC-2070 `58ee67e8` → 46/29, WIC-2071 `91811dc4` → 41/23, WIC-2072 `34a2503c` → 29/10, WIC-2068 `8c8e5cf2` → 23/3, WIC-2076 `2b3cdd55` → 21/3. See **What the remaining 24 are** below |
| **D3** local dev gets a real owner | ✅ landed | `middleware/auth.ts` supplies `LOCAL_DEV_USER_ID` (WIC-1964) |
| **D4** CI guard is the mechanism | ✅ landed | `scripts/audit-owner-predicates.mjs`, wired into `Lint & Test`; now four checks, `[LAUNDER]` added for the route layer |
| **D5** `[NOWNER]` checks owner-absent writes | ✅ landed, soundness fixed | was blind to a ternary's fallback arm; WIC-2067 classifies arm by arm and rewrote the 4 `catalog.service.ts` sites. One `or(...)` blind spot remains, 0 sites — see the caveat below |

Reproduce D1.2 + D1.3 (both must print `0`, and the second must print `string`):

```sh
grep -rn "c.get('userId') ?? undefined" packages/api/src/routes --exclude=require-owner.ts | wc -l
grep -n 'userId:' packages/api/src/types/env.ts
node packages/api/scripts/audit-owner-predicates.mjs --stats | grep LAUNDER
```

Reproduce D2 (the gated run must exit `0`; `--stats` prints the split):

```sh
node packages/api/scripts/audit-owner-predicates.mjs           # exit 0, "24 baselined site(s) remain"
node packages/api/scripts/audit-owner-predicates.mjs --stats   # [SIG] 21, [COND] 3, [NOWNER] 0, [LAUNDER] 0
```

Note that `--stats` **never gates** — only the bare run's exit code does. A green exit means *no
new* owner-absent branches, not zero of them; the baseline is what makes the difference, and it
holds 12 keys whose `count` fields sum to the 24 sites (21 `SIG` + 3 `COND`). Check that sum if
you ever suspect a coarse key is absorbing new sites — it is the cheapest integrity test there is.

### What the remaining 24 are — a backlog nobody can pick up

**Do not read "24 remaining" as available work** — that misreading is exactly why the D2 row no
longer carries a `⚠️`. Every one of the 24 is blocked or deliberate, per the WIC-2076 changelog
entry, which enumerates them:

| n | class | why it is not agent-actionable |
|---|---|---|
| 10 | forbidden by in-file headers (`interviewPrep.service.ts`, `resume-variant.service.ts`) | the header states the constraint; narrowing them contradicts it |
| 12 | on **nullable** `user_id` tables | needs a data backfill plus `SET NOT NULL`, which requires a human-gated `DATABASE_URL` against production |
| 1 | `analytics.service.ts` pre-auth telemetry | a documented guard false positive — an absent owner is the intended session-scoped case |
| 1 | entangled with a nullable-table caller | unblocks with the 12 above, not before |

So D2's remainder is gated on a **production data migration**, not on engineering time. The
signature change is the easy half and it is done; what is left cannot be typed away while the
column still admits `NULL`.

### Why the count fell by 76 in two days, and why that is not 76 units of work

Worth stating explicitly, because this document's own numbers caused the mistake once. WIC-2068's
card cited `[SIG] 71 / [COND] 29` from this table and scoped itself against it; by the time it was
picked up `main` had advanced six PRs and the true starting point was **29 / 10**. The changelog
records the conclusion: *"The 71 was never 71 units of work."*

The drop is real remediation (the five slices in the D2 row, each verified above), **not** a guard
becoming less sensitive and **not** a baseline regenerated to hide sites — WIC-2069's guard fix at
`feade4d7` left the counts at 71/29 exactly, and every baseline regeneration in the five slices was
downward by deletion only. But a count in a document is a measurement with a timestamp, and this one
decayed to a quarter of its value inside 48 hours while reading as a standing figure.

### Why D1.2 alone was not the mechanism for D1.3

The obvious expectation is that narrowing the type makes the laundering a compile error, so
that D1.2 gates D1.3 for free. **It does not, and this was measured rather than assumed.**
With `HonoVariables.userId` narrowed to `string`, reintroducing
`getDashboardStats(c.get('userId') ?? undefined)` in `routes/dashboard.ts` still gives
`tsc --noEmit` **exit 0**: a redundant `??` is legal TypeScript, not an error, and passing
`string | undefined` into a service that still accepts `userId?: string` (**21** such signatures
remain at `e50ec066`, down from 71 when this was written — the argument does not depend on the
count, only on the count being non-zero) is well typed at every one of those call sites.

So D1.2 makes the laundering *pointless* without making it *detectable*, and `[SIG]`/`[COND]`
cannot see it either — they key on service signatures and on predicates, and a route call
argument is neither. That is precisely the AC-2 failure mode this ADR was written about: a
criterion nothing executes. The `[LAUNDER]` check closes it, keyed on the fallback rather
than on the literal `undefined`, so `?? null`, `|| ''` and `?? 'anonymous'` are caught too.
Both controls are exercised in `test/audit-owner-predicates.test.ts`.

### Caveat on D5 — resolved by WIC-2067, and worth keeping for what it teaches

**This section described a live defect until 2026-09-05; it is now history. Do not re-file
it.** `[NOWNER]` used to treat a `where` predicate as owner-scoped whenever an owner column
appeared *anywhere* in it, so for a ternary it read the consequent, saw the owner term, and
passed the site without ever examining the arm that dropped the owner:

```ts
const whereClause = userId
  ? and(eq(t.slug, slug), eq(t.userId, userId))
  : eq(t.slug, slug);
```

That scored clean while the same defect written inline one line away was flagged — the
severity was inverted, with the site that *looks* scoped getting the milder grade. Against a
composite `(user_id, slug)` unique the fallback arm carries no `LIMIT`, so it rewrites one
row per tenant. Four such sites sat in `catalog.service.ts` `applyChange`.

**Both halves are now closed.** WIC-2067 (PR #378) classifies a conditional in predicate
position arm by arm — owner-scoped only if *every* arm carries the owner term — and rewrote
the four sites to an unconditional `and(...)`. Standing positive controls live in
`test/audit-owner-predicates.test.ts` under "[NOWNER] ternary fallbacks". D1.2 + D1.3
(this change) independently removed the route-level absence that would have had to reach
them, so the class is closed at both ends rather than at one.

Two things worth carrying forward, since the episode cost months:

- **A check is blind to any shape nobody wrote a failing fixture for**, and the prose
  describing it will overstate its reach in the meantime. The previous revision of this note
  claimed `[NOWNER]` "cannot be evaded", full stop; it was entitled only to a claim about
  *renames*. Prefer adding a fixture over widening a claim.
- **One disjunction blindness remains, in the other spelling.** `or(eq(t.userId, u),
  eq(t.slug, s))` still scores clean, because a conjunct anywhere in an `and(...)` chain
  soundly proves scoping and `scan` sets `owner` from any one operand — but under `or` the
  other operand still matches foreign rows. There are **zero** such write predicates in the
  tree today, which is the only reason this is a note and not a finding. It needs `or`
  classified operand-by-operand the way `?:` now is.

History: WIC-1672 (Finding 2) → WIC-2067.

## Context

Every tenancy fix in this repository so far has been scoped to one function, and the count
has still grown. The reason is that the question _"what may an authenticated request with no
resolved owner do?"_ has never been answered anywhere — so each card answers it again, locally,
and the shared fallback survives. WIC-1554 asks for the tree-wide answer and cannot give it from
inside one function; WIC-1596 and WIC-1549 re-derive the same question independently. WIC-238's
`plan` recommended settling it on 2026-08-26 and explicitly declined to file it. Three cards
re-derived it within a day.

This ADR is that answer.

### Where the affordance came from

It was deliberate, and it was never retired. ADR-003 specified the `user_id` column as
_"Nullable initially for migration from single-user data"_, with a migration path ending
_"existing data gets assigned to first logged-in user (or left as null for local-only)"_.
"Owner absent" was a **migration state**. The migration happened; the state became permanent,
because nothing was ever written down that said it should end.

(ADR-003 is also stale in its mechanism description: it documents Fastify and
`packages/api/src/plugins/auth.ts`. The code is Hono and `packages/api/src/middleware/auth.ts`.
Note that `src/plugins` is excluded from the API `tsconfig.json` — nothing in it is typechecked.)

### The measurement

Measured on `origin/main` at `0bb159b` (the card's table was taken at `1c54133`; the
48 sites are unchanged between the two).

The canonical shape is:

```ts
const w = userId ? and(eq(t.id, id), eq(t.userId, userId)) : eq(t.id, id);
```

With no caller, the `id` half runs alone — _absent owner_ and _all owners_ are the same value.

**The predicate is not one shape. It is at least three**, and this matters enormously for
choosing a mechanism:

| shape                            | example                                                  | sites                                                                                                                  |
| -------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| ternary                          | `userId ? and(...) : eq(t.id, id)`                       | `resume.service.ts:787`                                                                                                |
| `if`-guard on a conditions array | `if (userId) { conditions.push(eq(t.userId, userId)); }` | `resume-variant.service.ts:569`, `cover-letter.service.ts:365`, `application.service.ts:141` |
| spread                           | `...(userId ? [eq(t.userId, userId)] : [])`              | *(the three cited sites were all in `reports.service.ts`; burned down — see below)*                                     |

⚠️ **Every line number in this table is stale, and it is worth knowing why rather than repairing it
in place.** The four `reports.service.ts` citations this table carried — `:488` (`if`-guard) and
`:162, 266, 358` (spreads) — were burned down by **WIC-2065**, so those are gone for a good reason.
But the *remaining* citations had already rotted independently of that change: measured on this tree,
`application.service.ts:141` and `cover-letter.service.ts:365` are blank lines and
`resume-variant.service.ts:569` is a comment. They were accurate against the tree the survey ran on
and drifted with ordinary edits since.

So do not read a line number here as a location. **Re-derive the inventory with the guard**
(`node packages/api/scripts/audit-owner-predicates.mjs --stats`), which keys on the AST rather than
on a position. Note the guard's `[COND]` buckets are `ternary test` and `if test`, and a spread
`...(userId ? [x] : [])` counts as a *ternary test* — so the guard cannot separate rows 1 and 3 of
this table for you either. The taxonomy is the durable part of this section; the citations are not.

WIC-2065 also found a **fourth read-side shape this table does not list**: a `conditions` array
whose `where` degrades to `undefined` when the array is empty (`conditions.length > 0 ? and(...) :
undefined`). A bare `.where(undefined)` in drizzle is *no predicate at all* — strictly worse than
the three above, since it drops the non-owner filters too.

A fourth class exists that the card's table does not count at all — **write-side laundering**:
`userId: userId ?? null` inside `.values({...})` (`application.service.ts:68, 91, 324`;
`catalog.service.ts:741`; `cover-letter.service.ts:294, 678`; `interviewPrep.service.ts:483`;
`resume-variant.service.ts:459`; `resume.service.ts:544, 585`), and
`buildObjectKey(userId ?? null, ...)` (`resume.service.ts:529, 566`), which puts an ownerless
prefix on the storage path. These do not _read_ across tenants; they _create_ the ownerless rows
that the read predicates then match.

### Why the specs did not catch it

AC-T1..AC-T7 are quantified _"on behalf of user U"_ / _"carries `user_id = U`"_. Every clause
presupposes a U; none says what happens when there is none. Fail-open code satisfies all of them
**vacuously**. **AC-T0** was appended to all seven specs on 2026-08-27 (WIC-47 r4, WIC-94 r4,
WIC-101 r4, WIC-113 r4, WIC-127 r13, WIC-143 r7, WIC-238 r6):

> **AC-T0.** When no owner is resolved for a request, every read, write and existence check must
> match **zero rows**.

AC-T0 is a criterion. This ADR is the mechanism.

### It is not only the local-dev bypass

- `middleware/auth.ts:28-31` — the bypass needs **both** `SUPABASE_URL` and
  `SUPABASE_JWT_SECRET` absent. This is the branch the specs call "local-dev only".
- `middleware/auth.ts:62` and `:68` — **both** verify paths end
  `c.set('userId', (payload.sub as string) ?? null)`. A token that **verifies** but carries no
  `sub` yields `userId === null` with Supabase fully configured, and then calls `next()`.
- `middleware/auth.ts:6` — `PUBLIC_PATHS` is only the three `/api/auth/*` routes.

This is **not** a claim that Supabase issues `sub`-less tokens; that is unverified and probably
false. The point is that nothing asserts it cannot, so the production guarantee rests on an
unstated assumption about the issuer — and the fallback that assumption protects is "read every
tenant" rather than "fail". A guarantee whose failure mode is silent cross-tenant disclosure
should not rest on an unstated assumption.

## Decision

Adopt **both** postures. They are not alternatives; one closes the class and the other is
defence in depth.

### D1 — No anonymous authenticated caller exists (the posture)

An authenticated route either has an owner or returns 401. Concretely:

1. `middleware/auth.ts` rejects a token that verifies but carries no `sub`, on both the ES256/RS256
   and HS256 paths. `(payload.sub as string) ?? null` becomes an explicit 401.
2. `HonoVariables.userId` narrows from `string | null` to `string`.
3. The `c.get('userId') ?? undefined` laundering is deleted at every route.
   **74 of the 79 `c.get('userId')` call sites in `packages/api/src/routes` are exactly this
   expression** — this is the single choke point, and it is a far tighter funnel than the 48
   service-layer sites suggest.

### D2 — The owner is required per function (defence in depth)

Service signatures tighten from `userId?: string` to `userId: string`, per service, tracked by the
existing per-site cards. Once D1 lands, this is mechanical and the compiler locates every call site.

### D3 — Local development gets an owner, not an absence

This is the cost the card flags against Option A, and it dissolves rather than trades off.

Local dev without Supabase keeps working, but the bypass at `middleware/auth.ts:28-31` sets a
**real owner** instead of `null`: a `LOCAL_DEV_USER_ID` environment variable defaulting to the
`00000000-0000-0000-0000-000000000000` sentinel that migration `0017` already backfills to.

Single-user local dev therefore becomes _"one specific tenant"_ rather than _"no tenant"_. Every
tenancy predicate then runs its owner branch in local dev exactly as it does in production — which
also means local dev and E2E finally **exercise** the isolation logic instead of bypassing it.
There is no owner-absent code path left to protect, and ADR-003's "left as null for local-only"
affordance is retired.

### D4 — The enforcing mechanism is a CI guard, not a lint rule

**ESLint cannot be the mechanism here, and the reason is stronger than the card assumed.** The
card anticipated that _"an ESLint rule that cannot see a ternary's false branch catches zero of
them"_. Measured: the situation is simpler and worse — **`packages/api` has no ESLint config and
no `lint` script at all**. The only `eslint.config.js` in the repo is `packages/web/`, and root
`lint` is `npm run lint --workspaces --if-present`, so the API package is silently skipped. **Zero
of the 48 sites are lintable today.** Standing up ESLint for the API is a worthwhile project, but
it is not this one, and making it a prerequisite would block the guard indefinitely.

**The compiler alone is also insufficient**, though it is necessary. `tsc -b packages/api` _does_
run in the required `Lint & Test` job and _does_ cover `packages/api/src/services`
(verified below). But even with `userId: string`, the expression `userId ? A : B` still
typechecks, because the empty string is falsy. D1+D2 make the false branch **unreachable**; they
do not make it **rejected**. AC-2 asks for rejection.

So the mechanism is a small AST-based CI guard,
`packages/api/scripts/audit-owner-predicates.mjs`, using the TypeScript compiler's own parser —
so it sees every syntactic shape, not the one shape a regex was written for. It runs from the
existing `Lint & Test` job, following the precedent already set there by
`python3 docs/design/wireframe-casing-audit.py` and `npm run scan:secrets`.

It reports three checks:

- **`[SIG]`** — an exported function whose owner parameter is optional or nullable. This is the
  _precondition_ for a fail-open predicate: you cannot branch on an absent owner if absence is
  unrepresentable. This is the check that enforces D2.
- **`[COND]`** — the owner identifier in a conditional position (ternary test, `if`, `&&`/`||`,
  `!owner`, `owner == null`). This catches a predicate reintroduced against a still-optional
  signature.
- **`[NOWNER]`** — an UPDATE or DELETE against an owner-bearing table whose `where` predicate
  contains no owner column. Added by D5 below.

### D5 — The guard also checks owner-**absent** writes, not only fail-open predicates

`[SIG]` and `[COND]` measure sites where the owner is _representable-as-absent and branched on_.
They say nothing about a site that never mentions the owner at all — and such a site is **strictly
worse** than a fail-open ternary. A ternary degrades only when the owner is absent; a write with no
owner term fires unconditionally, **even when the owner is present**, matching every tenant's row.

That class also inverted the burndown metric. A site that ignores the owner entirely satisfies the
letter of both checks, so it yielded no finding and appeared in **neither the numerator nor the
denominator** of the 157 → 131 count. Its absence read as health.

`[NOWNER]` closes that hole. It keys on the **schema column** rather than on a parameter name:
owner-bearing tables are read out of `packages/api/src/db/schema.ts` at run time, so a new table
declared with a `user_id` column is in scope the day it lands, and the check cannot be evaded by
the two one-line re-spellings that defeat the name-based checks (renaming `userId` to `callerId`,
or hiding optionality behind a type alias).

**It distinguishes cardinality, because the severities genuinely differ.** A write scoped by a
primary key or a `.unique()` column matches at most one row and cannot fan out across tenants;
whether that id was itself owner-checked upstream is an IDOR question this guard does not answer.
Those are **counted and printed on every run**, but not gated on. Only a write scoped by a
**non-unique** key with no owner term is a finding — which is exactly the shape the schema settles,
since uniqueness on these tables is declared as `(userId, key)`, making the key alone non-unique
across tenants by declaration.

**What a green run does NOT assert** is now printed on every run and listed by `--stats`: the
unique/pk-scoped writes above, any predicate the script cannot resolve, and read-side (`SELECT`)
cross-tenant leaks, which are real but a far larger population and should be measured before being
gated. A guard that prints only its own findings makes its blind spots invisible — which is how a
green run came to be read as tree-wide owner-scoping health.

**The guard now has positive controls of its own** (`packages/api/test/audit-owner-predicates.test.ts`,
21 cases). The guard is what is advertised to hold the line as _new_ sites appear, and a new site
has no tests yet, so the guard's own detection has to be the thing under test. Each case is a
one-line re-spelling of a real pattern, run against a synthetic fixture tree via `--root` so the
cases stay stable as the burndown proceeds. Notably the suite pins the fail-**closed** exemption:
`if (!userId) throw` is the posture this ADR asks for, and counting it as a violation would make
the fix read as the defect.

**It ships in baseline mode.** `origin/main` carries 157 findings at the commit this guard lands on
(`5e2956b`); it carried 138 when the set was first frozen at `1c54133` a day earlier — see
"The guard fires on real merged code" below, which is the whole argument for this ADR. Failing on all of them
would make the guard unlandable until the very last site is fixed — which is precisely the
deadlock that let the count reach 48. The guard freezes the known set in
`packages/api/scripts/owner-predicates.baseline.json` and fails only on **new** sites. The baseline
is keyed on file + check + normalised detail, never on line number, so unrelated edits above a site
do not spuriously trip it. Occurrences are counted, so removing one site cannot mask adding
another. The baseline is burned down by WIC-1549 / WIC-1554 / WIC-1596 and never appended to by hand.

**What the 157 is, precisely.** It counts owner-absent *branches*, and a branch is not automatically
fail-open — the correct fail-closed shape (`isNull`, which selects the empty set) is also a branch
and is also counted. So the honest question is what fraction of the 157 actually degrades to a
broader read. Measured across the whole scan scope on `293ba46`: **4 `isNull` owner branches exist
in total**, in three files (`personal-info.service.ts` ×2, one of them the single allowlisted site;
`interviewPrep.service.ts` ×1; `resume-variant.service.ts` ×1). Every other counted branch drops the
ownership term and falls back to an id- or slug-only predicate. `catalog.service.ts`, which carries
14 of the 19 new sites, contains **no `isNull` at all** — all 17 of its owner ternaries degrade.
The count is therefore not a mixed bag that needs triage before it means anything; it is
near-uniformly the shape D1 prohibits, and the two deliberate exceptions are already documented
in-place as such.

## Verification

AC-2 requires that the mechanism be shown to actually fire, not asserted to. All figures below were
measured on `origin/main` `0bb159b`.

**The compiler is a real, running mechanism** (negative control, per repo convention):

| run                                                                               | result           |
| --------------------------------------------------------------------------------- | ---------------- |
| `tsc -b packages/api --noEmit` on clean `main`                                    | exit 0           |
| same, with `const __negControl: string = 123;` appended to `dashboard.service.ts` | exit 1, `TS2322` |

So `packages/api/src/services/**` _is_ typechecked and _does_ fail CI — unlike the API `test/`
directory and the solution-style `packages/web/tsconfig.json`, neither of which typechecks anything.

**The guard covers the entire table.** Cross-checked against all 48 sites in WIC-1600:

| service                     | sites in table | detected        | missed |
| --------------------------- | -------------- | --------------- | ------ |
| `catalog.service.ts`        | 9              | 9               | 0      |
| `resume-variant.service.ts` | 7              | 7               | 0      |
| `cover-letter.service.ts`   | 7              | 7               | 0      |
| `application.service.ts`    | 6              | 6               | 0      |
| `interviewPrep.service.ts`  | 6              | 6               | 0      |
| `resume.service.ts`         | 5              | 5               | 0      |
| `project.service.ts`        | 4              | 4               | 0      |
| `reports.service.ts`        | 2              | 2               | 0      |
| `dashboard.service.ts`      | 1              | 1               | 0      |
| `personal-info.service.ts`  | 1              | 1 (allowlisted) | 0      |
| **total**                   | **48**         | **48 (100%)**   | **0**  |

The guard finds **62 `[COND]` sites tree-wide, not 48** — the card's table undercounts by 14,
because it was assembled by reading for the ternary shape. It also finds **76 `[SIG]` sites**, the
root cause. `job-fit.service.ts` and `onboarding.service.ts` report zero, as expected.

**The guard rejects newly added predicates in every shape** (each injected into
`dashboard.service.ts` against a frozen baseline):

| injected                                                                      | guard              |
| ----------------------------------------------------------------------------- | ------------------ |
| new ternary — `userId ? eq(...) : undefined`                                  | **fails**, exit 1  |
| new `if`-guard — `if (userId) { conds.push(...) }`                            | **fails**, exit 1  |
| new optional signature — `newLeak(userId?: string)`                           | **fails**, exit 1  |
| _negative control:_ three comment lines prepended, shifting every line number | **passes**, exit 0 |

The last row is the one that makes the guard survivable in practice: it is line-independent, so it
does not cry wolf on unrelated edits.

### The guard fires on real merged code, not just injected code

The rows above are injections. This one is not, and it is the reason this ADR should land.

The baseline was frozen against `origin/main` `1c54133`. One day later, this branch merged
`origin/main` `5e2956b` and the guard **failed** — on code nobody injected:

| key                                                        | baseline → now |
| ---------------------------------------------------------- | -------------- |
| `catalog.service.ts` `[COND]` ternary                      | +10            |
| `catalog.service.ts` `[SIG]` optional owner                | +3             |
| `catalog.service.ts` `[COND]` `if`                         | +1             |
| `resume-variant.service.ts` `[SIG]` optional owner         | +2             |
| `resume-variant.service.ts` `[COND]` ternary               | +1             |
| `interviewPrep.service.ts` `[SIG]` optional owner          | +1             |
| `interviewPrep.service.ts` `[COND]` ternary                | +1             |
| **total**                                                  | **138 → 157**  |

Thirty shape-keys before, thirty after: **no key went down.** Not one site was fixed in that window;
nineteen were added.

The commits that added them are, without exception, tenancy fixes. Re-measured per merge on
2026-08-29 by running the guard against each `origin/main` tree in the window, the +19 is not spread
across the burndown — **three merges carry all of it, and three carry none**:

| `origin/main` merge                             | card     | count | delta |
| ----------------------------------------------- | -------- | ----- | ----- |
| `6704836` (#124)                                | WIC-1354 | 138   | —     |
| `5f89362` (#128) catalog merge tenancy          | WIC-1365 | 149   | **+11** |
| `d7c5854` (#132) catalog tag patch tenancy      | WIC-1373 | 152   | **+3**  |
| `f457cc3` (#134) catalog merge `inArray`        | WIC-1377 | 152   | +0    |
| `e6eec1c` (#137) merge target not source        | WIC-1395 | 152   | +0    |
| `20be03f` (#145) merge first-seen               | WIC-1360 | 152   | +0    |
| `5e2956b` (#153) UC6/UC7 tenancy                | WIC-1449 | 157   | **+5**  |

The three that added sites are exactly the three that introduced new exported service functions; the
three that added none were edits to call sites and predicates already counted. So the mechanism is
specific and predictable — **the defect enters with each new owner-optional export**, not diffusely
with tenancy work in general. That is what makes a signature-level guard the right instrument.

Two further measurements from the same sweep:

- **Gross, not net — through `293ba46`.** Comparing the full keyed finding sets at `d84da39` (138)
  and `293ba46` (157): 19 added, **0 removed**.
- **It only moves on service-layer merges.** 157 has held flat from `5e2956b` (08-27) through
  `293ba46` (08-29) across three intervening merges — all docs-only. The baseline is not drifting
  noise; it is a step function keyed to exports.

> **Correction, measured 2026-08-30 on `origin/main` `614ad91`: the count has now gone down, and
> the "never once gone down" claim above is withdrawn.** Re-running this guard against `614ad91`
> scores **144**, not 157 — a drop of 13, arising entirely in two files:
> `resume-variant.service.ts` 17 → 10 and `interviewPrep.service.ts` 15 → 9. Every other file is
> unchanged to the site. The cause is **WIC-1601** (`1a2a100`, `34d61b5`), which scoped the reads on
> every table those two services touch and then deleted `bulletOwnerScope` in favour of a single
> generic helper.
>
> **Two things this does and does not mean, because the drop is not 13 fixed sites.** The
> replacement helper is
> `function ownerScope<T extends { userId: PgColumn }>(table: T, userId?: string)` returning
> `userId ? eq(table.userId, userId) : isNull(table.userId)` — it is **fail-closed**, and it is now
> called at 27 sites across the two files. So part of the drop is a genuine posture improvement, and
> part is **consolidation**: collapsing two helpers into one retires `[SIG]` and `[COND]` findings
> without changing any caller's behaviour. The step-function-keyed-to-exports mechanism above still
> holds; what is now falsified is only the monotonicity. Read the number as *the count of
> owner-absent branches*, which is what it has always literally been — never as a safety score.
> This also supersedes the "4 `isNull` branches in total" figure measured on `293ba46` in the
> Context section: the fail-closed shape is now the **majority** shape in these two files.

The new sites are new exported functions written in the exact shape this ADR exists to prohibit:

```ts
export async function mergeCompanies(sourceIds: string[], targetId: string, userId?: string) {
  const target = userId
    ? and(eq(companyCatalog.id, targetId), eq(companyCatalog.userId, userId))
    : eq(companyCatalog.id, targetId);
```

`mergeJobFitTags` and `mergeTechStackTags` are the same, and each also degrades its `inArray`
source read. So the burndown is not converging: **the per-site fixes are reproducing the defect
faster than they retire it**, which is precisely the recurrence WIC-1554 named and precisely what
AC-2 asks a mechanism to stop. A criterion that nothing executes did not survive one day.

**On re-freezing the baseline.** This ADR's own rule is *burn the baseline down, never append to
it*. Re-freezing at the landing commit (`5e2956b`, 157) is not an exception to that rule but its
precondition: a guard pinned to a baseline older than the commit it merges into fails on debt it did
not create and can never land. The +19 is recorded above rather than absorbed silently — that is the
difference between re-freezing and appending. Every site added **after** `5e2956b` fails CI.

### D5 — what `[NOWNER]` found on first run

Measured on the WIC-1638 burndown head (`341d897`, the tree where `[SIG]`+`[COND]` report a clean
131 and CI is green). Of **46** UPDATE/DELETE sites against the **21** owner-bearing tables:

| class                              | count | gated |
| ---------------------------------- | ----: | ----- |
| owner-scoped                       |    21 | —     |
| unique/pk-scoped (at most one row) |    18 | no    |
| predicate unresolvable             |     0 | no    |
| **non-unique key, no owner term**  | **7** | yes   |

The 7 are the finding. Four are the `extraction.service.ts` catalog updates (`companyCatalog`,
`techStackTags`, `jobFitTags`, `recurringThemes`), each scoped by a business key whose uniqueness is
declared as `(userId, key)` — **already fixed on PR #141 (WIC-1404)**, which is sitting in the
review queue.

**Three were previously unreported:** `project.service.ts:464`, `:512`, `:548`, all
`db.update(projects).set({ updatedAt }).where(eq(projects.slug, slug))`. `projects` declares
`uniqueIndex('idx_projects_user_slug').on(t.userId, t.slug)`, so `slug` alone is non-unique across
tenants by the same argument, and each of these touches every tenant's project with that slug. No
fix is in flight for them; tracked separately.

All 7 are frozen into the baseline (131 → 138) under the same rule as the rest: the guard fails on
**new** sites, and burning these down is the burndown's job. `[SIG]`+`[COND]` remained at exactly
131 across the `[COND]`/`[SIG]` hardening in this change — the added coverage found no new real
sites in this tree, so the hardening is not a metric-inflating change.

## Consequences

### AC-3 — check the column before choosing the predicate

`isNull(user_id)` is fail-closed **only** where migration `0017` rewrote pre-existing NULLs to the
sentinel. Everywhere else `IS NULL` matches real rows, so using it as the owner-absent predicate
reintroduces the bug in a new costume. **The card lists 7 nullable tables. The true count is 14 of
21** — the ones below must never use `isNull` as an ownership predicate:

**NOT NULL (7):** `onboarding_status`, `projects`, `company_catalog`, `job_fit_tags`,
`tech_stack_tags`, `quantified_bullets`, `recurring_themes`.

**NULLABLE (14):** `applications`, `status_history`, `resumes`, `resume_exports`,
`catalog_change_log`, `catalog_diffs`, `wikilink_registry`, `cover_letters`, `outreach_messages`,
`resume_variants`, `interview_preps`, `interview_prep_stories`, `prep_question_story_links`,
`personal_info`.

**A gap worth fixing separately: `catalog_diffs` is backfilled but not constrained.** Migration
`0017` STEP 1 rewrites its NULLs to the sentinel, but STEP 2 never adds `SET NOT NULL` — it is the
only one of the seven backfilled tables omitted. So historical NULLs were cleaned up and new ones
can be written again, which is exactly what `catalog.service.ts:741`'s `userId: userId ?? null`
does. Five of `catalog.service.ts`'s nine sites key on `catalogDiffs.id`. This should be its own
card; it is not fixed by this ADR.

### The guard must not reject its own remediation (WIC-1853)

The Backend Developer measured, and I reproduced at head `00036f1`, that the guard **failed CI on
the very fix this ADR points people at**. Appending WIC-1601's verbatim `ownerScope` helper —

```ts
function ownerScope<T extends { userId: PgColumn }>(table: T, userId?: string) {
  return userId ? eq(table.userId, userId) : isNull(table.userId);
}
```

— to any service lacking one exits `1`. Two independent causes, both in the guard, neither in the
code under test:

1. **`[COND]`** read only `node.condition` and never `whenFalse`, so fail-**closed**
   `: isNull(t.userId)` and fail-**open** `: idTerm` — opposite postures — produced an identical
   finding.
2. **`[SIG]`** flagged the helper's `userId?: string` parameter, which the helper *must* have,
   because representing absence is its entire job.

`[SIG]` headroom was **0 in all 14 baselined service files**, so there was nowhere the remediation
could land for free. A guard that blocks the burndown it exists to drive is worse than no guard: it
converts the ADR into a dead letter and teaches everyone to ignore the check. Fixed by recognising
the fail-closed scope helper **by shape** rather than by coordinate.

**One narrowing beyond what was proposed.** Testing only that the false branch *calls* `isNull` is
too loose — `userId ? eq(t.userId, userId) : isNull(t.archivedAt)` drops the owner term for a
predicate on an unrelated column, which is fail-**open**, and a callee-only test exempts it
(case G). The shipped check also requires the `isNull` **argument** to be an owner column.

Every case below was run for real at head `00036f1`, three of them negative controls, so the
narrowing is specific to owner-column `isNull` false branches and does not blind `[COND]`:

| case | scenario | want | got |
|---|---|---|---|
| A | patched guard, clean head, frozen baseline | 0 | **0** — 139 remain, 18 fixed |
| B | verbatim `ownerScope` adoption in a service lacking one | 0 | **0** |
| C | fail-**open** ternary helper (`: undefined`) | 1 | **1** |
| D | inline fail-open ternary at a call site | 1 | **1** |
| G | `isNull` on a **non-owner** column | 1 | **1** (proposed form: **0** ❌) |

The exemption covers exactly three helpers — `interviewPrep:56`, `resume-variant:82`,
`personal-info:33` — taking the count 144 → 139. The baseline file is **byte-unchanged**, so the
`#209 → #220 → #227` merge order is undisturbed.

**This exemption is an AC-3-bounded concession, and the ADR should say so plainly.** `isNull` is
genuinely zero-rows only on the 7 backfilled NOT NULL tables. On the 14 nullable ones it matches
real rows, so it *narrows* rather than matching zero rows, and is not yet AC-T0-clean. The AST
cannot see column nullability, so the exemption is a **syntactic proxy**, justified because the
shape it admits is always strictly safer than the defect it replaces — dropping the owner term
selects every tenant, `isNull` selects at most the unowned one. Closing the remaining gap is AC-3's
job (choose the predicate per column) and AC-4's (assert the query), not this guard's. Recording it
here so nobody later reads a green guard as proof of AC-T0 on a nullable table.

This is the **third** measured imprecision in this guard, and they now bracket it on both sides:
it counts safe branches (here), it is blind to branchless violations (the `extraction.service.ts`
false green below), and it over-reported regressions (fixed alongside — a tripped key printed every
site sharing it, so the repro's 2 new sites rendered as 13; the message now carries `N of M in this
key are new`). **A green run of this guard is evidence about AC-T0 branch shapes and nothing else.**

### AC-4 — assert the query, not the status code

A not-found guard and an ownership guard return the same status, so a response-code assertion
cannot distinguish them. Per-entry-point tests must assert the emitted query or spy the write path.
Note that after D1+D2 the _service-layer_ absent-owner test becomes unwriteable by construction —
which is the point. The test that remains, and matters, is at the **middleware**: a token that
verifies with no `sub` must 401. That is one test, not 47.

Note also that `packages/api/tsconfig.json` excludes `test/`, so these tests are not typechecked;
they must therefore be run, not merely compiled, to have any force.

### AC-5 — two sites are already correct and must not change

- `personal-info.service.ts:34` — `userId ? eq(...) : isNull(personalInfo.userId)` is deliberate
  and correct: `personal_info.user_id` really is nullable and single-user local rows really do
  carry NULL (`0014:44-48`). It is exempted in the guard **by shape** — see "The guard must not
  reject its own remediation" below — and the guard reports zero findings for it. *(Until WIC-1853
  it was allowlisted by file and line; that entry has been deleted as redundant.)*
- `onboarding.service.ts` — the owner is required by every signature already. The guard reports
  zero findings. This service is the model for what D2 produces everywhere else.

### AC-T0 is deliberately **not** widened, and this guard measures AC-T0 only

This question has now been raised four separate times as a suspected requirements gap (WIC-1672
Finding 2, WIC-1623, the Code Reviewer's 2026-08-29 review comment, and WIC-1756). It is recorded
here so it stops recurring. The Business Analyst's ruling on WIC-1756 is **adopted**; the
verification below is independent and adds a measurement the ruling argued for structurally.

**The premise is true and is not a gap.** Ten predicates in the service layer carry no owner term at
all — they are not owner-*optional*, they are owner-*absent*, so they satisfy AC-T0 vacuously.
Re-derived independently at `origin/main` `614ad91` across all 20 service files; the cohort is
exactly these ten, and every one is already **not met** under an accepted criterion with an owning
card:

| sites                                                       | already bound by | card     |
| ----------------------------------------------------------- | ---------------- | -------- |
| `extraction.service.ts:59,87,114,164` — UPDATEs             | AC-T2 (WIC-101)  | WIC-1404 |
| `extraction.service.ts:553,599` — create-vs-update SELECTs  | AC-T3 (WIC-101)  | WIC-1406 |
| `project.service.ts:464,512,548` — UPDATEs                  | AC-T2 (WIC-94)   | WIC-1433 |
| `project.service.ts:597` — `getOrCreateProjectBySlug`       | AC-T3 (WIC-94)   | WIC-1434 |

Coverage is 10/10, so widening AC-T0 would restate a property AC-T1..AC-T3 already assert, and split
one requirement across two clauses whose **enforcement points differ**: AC-T0 is discharged at the
**entry point** (D1's 401 makes an ownerless request unrepresentable); AC-T1..AC-T3 are discharged
at the **predicate**. A site can satisfy either and violate the other. PR #141 is the worked
example — it had to make `applyChangeToDb`'s `userId` non-optional (D2) *and* separately add
`eq(<table>.userId, userId)` to six predicates. Neither edit implies the other.

**Measured consequence for the burndown metric — a false green.** Because this guard's two checks
are `[SIG]` (an optional/nullable owner parameter) and `[COND]` (an owner term inside a
conditional), a *branchless* ownerless predicate matches neither: it enters neither numerator nor
denominator, and its file need not appear in the table at all. Counterfactual run on `614ad91`,
changing **only** the AC-T0 signature in `extraction.service.ts` (`userId?: string | null` →
`userId: string`) and touching no predicate:

| tree                                        | guard output                                                  | `extraction.service.ts` entries | ownerless predicates still present |
| ------------------------------------------- | ------------------------------------------------------------- | ------------------------------- | ---------------------------------- |
| `614ad91` clean                             | 144 sites                                                     | 1 (the `[SIG]`)                 | 6                                  |
| `614ad91` + signature fix only              | `no new owner-absent branches … 1 fixed since baseline`, exit 0 | **0**                           | **6**                              |

The file scores zero, drops out of the burndown table entirely, and the guard reports *progress* —
while all six cross-tenant predicates remain byte-unchanged. **A green branch-count is therefore not
evidence for AC-T1..AC-T3.** Combined with the fail-closed over-count corrected above, this guard is
imprecise in both directions: it counts branches that are safe, and cannot see violations that have
no branch.

This is a scope statement, not a defect in the guard — AC-T0 is what it was built to enforce, and it
does that. Two obligations follow:

1. **Any burndown quoted against these specs must name the clause it measures.** "157/144 sites" is
   an AC-T0 figure. It is not a tenancy-safety score and must not be reported as one.
2. **The predicate-level counterpart is the `[NOWNER]` check** (WIC-1672, PR #227), which detects
   exactly the branchless shape this one cannot. The two are complementary and neither substitutes
   for the other.

### A dev-mode 400/401 is D3 unimplemented — it is not a reason to relax D1/D2 (WIC-1962)

Settled here because it is the same question arriving in a new costume, and this ADR exists to stop
that. A route answering `400`/`401` in the local auth-bypass mode is the **intended** posture while
D3 is unimplemented; it is not evidence that the owner-required change went too far, and the remedy
is never to re-open an owner-absent branch in a service.

The worked instance is `project.service.ts`. PR #316 (WIC-1901) and `main`'s WIC-1554 reach the same
file from opposite directions: WIC-1554 routes every `projects` access through `requireOwner`, which
is exactly this ADR's D2 for that service and is named as such in the remediation list above. #316
instead keeps the bypass mode serving project routes, via per-caller `if (!userId)` guards that
short-circuit before the scope helper. **#316's design is refused.** Three reasons, in order of
weight:

1. **It contradicts AC-T0 and D1 directly.** "Every read, write and existence check must match zero
   rows" does not admit a mode in which reads are served from an owner-less caller. D1 already says
   an authenticated route either has an owner or returns 401.
2. **It does not achieve AC-T0 even on its own terms.** Measured 2026-09-02 on PGlite against #316
   at `949ba5e8`, seeded with two tenants both holding the slug `acme-corp`:
   `listProjects(undefined)` returns **both tenants' rows**, and `getProject(<A's id>, undefined)`
   returns **A's row** — because #316 branched before `projectIdScope`/`requireOwner` existed and
   left `.where(userId ? eq(...) : undefined)` and an id-only predicate in place. `main` throws on
   both. #316's own AC-T0 suite asserts neither path, which is why its security assertions pass
   under both designs — the assertion set has a hole exactly where the design is weakest. This is
   the AC-4 lesson again: a spec that never quantifies the absent owner is satisfied vacuously.
3. **The mode it defends is not reachable fail-closed.** `projects.user_id` is `NOT NULL` and
   `createProject` has rejected an owner-less caller since WIC-1434, so **no `projects` row can ever
   exist for the bypass caller**. The DB half of every project operation in that mode is therefore
   necessarily either skipped or unscoped — there is no third option, and "working dev mode" over a
   table you cannot write to resolves to reading rows that belong to somebody else. #316 does not
   deliver the mode either: `createProject` and `getOrCreateProjectBySlug` still `400`, and
   `getOrCreateProjectBySlug` is the entry point for resume upload (`resume.service.ts:674,723`) and
   dialogue capture (`dialogue.service.ts:209`). What the trade buys is browsing an `anon`
   filesystem tree the API has no way to populate.

**The dev-ergonomics cost #316 identified is real, and D3 is where it is paid.** Until D3 lands
there is also a one-variable workaround that is strictly better than the bypass: the HS256 branch of
`middleware/auth.ts` needs only `SUPABASE_JWT_SECRET`, with no Supabase project, so setting it in
`.dev.vars` and minting a local HS256 token with any UUID `sub` gives every project route a real
owner — and exercises the isolation logic instead of bypassing it, which is D3's stated benefit
arriving early.

### Costs and risks

- **D3 changes local-dev behaviour.** Any existing local database with genuine `NULL` `user_id`
  rows will appear empty after the change, because local dev now queries as the sentinel tenant.
  This is correct behaviour and a real one-time migration cost for anyone holding such data; a
  one-line `UPDATE ... SET user_id = '00000000-...-0' WHERE user_id IS NULL` recovers it.
- **D1 is a behaviour change at the edge.** Any caller today relying on an ownerless request
  succeeding will begin receiving 401. That is the intent, but it should land on its own commit so
  it is trivially revertable.
- **The baseline can rot.** A baseline that is appended to instead of burned down is worse than no
  guard, because it looks like coverage. The baseline file should only ever shrink; a PR that grows
  it needs an explicit reviewer note.
- **The guard is name-based.** It keys on identifiers named `userId` / `ownerId`. A predicate
  written against a differently-named binding evades it. This is an accepted limitation: the guard
  is the ratchet, and D1+D2 are the actual fix.

## Sequencing

- **This ADR (AC-1)** — no code dependency; landable now.
- **The guard + baseline (AC-2)** — `packages/api/scripts/audit-owner-predicates.mjs` plus one CI
  step. Independent of the service edits by design, and worth landing early: from the moment it
  merges, the population can only shrink.
- **D1 (middleware + `HonoVariables` + route laundering)** — one commit, 74 mechanical deletions.
- **D2 (per-service signatures)** — WIC-1549, WIC-1554, WIC-1596, WIC-1435. WIC-1596 asks that
  code changes not start before PR #203 merges, which lands the mutation detector this work is
  verified by. PR #203 is `MERGEABLE` / `CLEAN` with all checks green as of 2026-08-27 03:18Z.
- **`catalog_diffs` NOT NULL** — separate card, not covered here.

## References

- WIC-1600 — this decision
- WIC-1430 — document `tenancy-absent-caller-audit`; AC-T0 appended to all seven specs
- WIC-1549, WIC-1554, WIC-1596, WIC-1435 — per-site remediation
- WIC-1962 — a dev-mode 400/401 is D3 unimplemented; PR #316's owner-less project mode refused
- ADR-003 — multi-user auth; origin of the nullable-`user_id` affordance retired here
- `packages/api/src/db/migrations/0017_enforce_userid_not_null.sql`
- `packages/api/src/db/migrations/0014_fix_personal_info_schema.sql` (lines 44-48)
