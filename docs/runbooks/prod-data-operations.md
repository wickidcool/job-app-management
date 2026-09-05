# Runbook: the two pending production data operations (WIC-1464, WIC-1929)

Two cards have been parked for days waiting on the same scarce thing — **a human holding
production credentials, running one command**. Neither is waiting on code: both scripts are
merged, tested, and on `main`. This runbook exists so that human step costs one sitting
instead of two investigations.

| card | script | credentials needed | mutates? |
|---|---|---|---|
| **WIC-1464** (AC-a) | `packages/api/scripts/audit-foreign-star-text.mjs` | `DATABASE_URL` | **no** — enforced read-only |
| **WIC-1929** | `packages/api/scripts/migrate-project-storage-keys.mjs` | `DATABASE_URL` + R2 | object storage only, and only under `--apply` |

Run them in the order below. Operation 1 is read-only and settles a question; operation 2 has a
dry-run that is also read-only. **Neither step's default invocation can damage anything**, so the
whole of §1 and §2.1 can be run without a decision being made first.

> WIC-1464 AC-d asks that these two be sequenced together. That is the only reason they share a
> document — they are independent operations and either may be run alone.

---

## 1. WIC-1464 AC-a — audit foreign STAR text (read-only)

### What it answers

Whether cross-tenant STAR text from the pre-fix period is still sitting in `resume_variants.content`
and `interview_prep_stories`. PR #153 stopped *new* leakage; it could not reach copies already
frozen into generated artefacts. **The count may well be zero** — nothing is decided until it is known.

### Why this is safe to run right now

Every statement runs inside a `BEGIN READ ONLY` transaction, so **Postgres itself rejects a write**
even if the script acquired one by mistake. That is the difference between *documented* read-only and
*enforced* read-only, and it is what makes running this against production safe while the AC-b
disposition is still open. It needs no approval.

### Command

```bash
cd packages/api
DATABASE_URL='<prod>' node scripts/audit-foreign-star-text.mjs --json
```

Drop `--json` for the human-readable report; it prints the same numbers plus an interpretation line.

> ⛔ **Never pass `--samples N`.** That flag prints the leaked STAR text itself. It exists for local
> debugging only. Its output goes to stderr specifically so a `> file.json` redirect cannot capture
> it by accident — **do not paste `--samples` output into a ticket, comment, or chat.**

### Reading the result

The report classifies every candidate row into a three-way verdict, which matters:

- **`foreign`** — confirmed cross-tenant. Both owners are known and they differ. This is the number
  that drives AC-b.
- **`indeterminate`** — one side's owner is `NULL` or the migration-0017 placeholder. **Not a leak**,
  and must not be counted as one. `NULL <> NULL` is not a mismatch — this is the exact case the card
  warned would be got wrong, and the predicate tests pin it.
- **`same`** — owners match. Fine.

Also reported: **distinct victim owners** across both tables, and `interview_prep_stories` whose own
`user_id` disagrees with its parent prep.

### Decision tree (AC-b)

| result | what happens next | who decides |
|---|---|---|
| `foreign == 0` on both tables | **Nothing to remediate.** Record the JSON on WIC-1464 and close AC-a + AC-b. AC-c never runs. | agent can close it |
| `foreign > 0` | AC-b is a **data-loss call on user-visible artefacts** — delete / strip-in-place / regenerate. **Route to the board.** Do not pick one unilaterally. | **board** |
| only `indeterminate > 0` | Not a leak. Decide separately whether legacy/orphan rows are in scope at all. | agent, with a note |

The script prints this conclusion itself, so you do not have to infer it from the counts.

Paste the `--json` output (safe — it contains counts and ids, never text) onto WIC-1464.

---

## 2. WIC-1929 — relocate project artefacts to owner-namespaced storage keys

### What it does

```
legacy   projects/{slug}/{file}            <- shared by every user holding {slug}
current  projects/{userId}/{slug}/{file}
```

Migration 0017 dropped the global unique on `projects.slug`, so a slug can now be held by more than
one user. Where that happened, the legacy directory is **a commingling of two people's files with
nothing in the object store recording who wrote what.**

### The safety property worth knowing before you start

**The script will not guess.** An unattributable slug is reported and *left exactly where it is*,
and the run exits non-zero so a deploy cannot mistake "partially migrated" for "done". Likewise a
legacy file whose namespaced destination is already occupied is **never** moved — that would be an
overwrite plus an unrecoverable delete, not a migration.

It also performs **no Postgres writes at all**. Its only statement is
`SELECT slug, user_id FROM projects ORDER BY slug, user_id`. All mutation is against object storage.
That usefully bounds the blast radius: a bad run costs stored objects, not rows.

It is **idempotent** — a second run finds no legacy keys and exits 0.

### 2.1 Dry run first (no flag = dry run)

```bash
cd packages/api
DATABASE_URL='<prod>' \
R2_ENDPOINT='<...>' R2_ACCESS_KEY_ID='<...>' R2_SECRET_ACCESS_KEY='<...>' R2_BUCKET='<...>' \
node scripts/migrate-project-storage-keys.mjs
```

Prints `Would move: projects/{slug}/{file} -> projects/{userId}/{slug}/{file}` (first 20, then a
count of the remainder).

### 2.2 Read the exit code — it is the decision point

| exit | meaning | next step |
|---|---|---|
| **0** | `All legacy project artefacts are attributable.` | Safe to proceed to §2.3. |
| **2** | Some files could not be placed: *N unattributable slug(s)* and/or *M occupied destination(s)*. | **Stop.** See §2.4 — this is the human call the card is actually blocked on. |
| 1 | Script/connection error (e.g. `DATABASE_URL` unset, R2 env incomplete). | Fix the environment and re-run. |

### 2.3 Apply — only if the dry run exited 0

```bash
# identical command, plus --apply
... node scripts/migrate-project-storage-keys.mjs --apply
```

Copies then deletes the source, and prunes emptied legacy directories. Reports
`Moved N file(s); removed M legacy index(es).`

Re-run without `--apply` afterwards to confirm it now exits 0 with nothing to move.

### 2.4 If the dry run exits 2 — the actual blocker

This is the judgement the `human_only` ask on WIC-1929 is asking for, and it is **not mechanical**:
for each commingled slug, deciding which user owns which file is a business/data-attribution call
that the object store holds no evidence for. Options, per slug:

- attribute the whole legacy directory to one named user;
- leave it in place indefinitely (the files remain readable at the legacy path — nothing breaks);
- delete, if the artefacts are known-stale.

Record the per-slug decision on WIC-1929 before anyone re-runs with `--apply`. The script will keep
refusing until each is resolved, which is the intended behaviour, not a failure.

### Local-dev variant

Against `{dataDir}/projects/{slug}` instead of R2 — no R2 credentials needed:

```bash
DATABASE_URL='...' node scripts/migrate-project-storage-keys.mjs --local ./data [--apply]
```

---

## Why these cannot be done by an agent

Both need production credentials (`DATABASE_URL`, and R2 keys for WIC-1929) that no agent seat
holds. WIC-1929 additionally needs the §2.4 attribution judgement, and WIC-1464 needs the AC-b
disposition call if the count comes back non-zero. The `human_only` label on both pending asks is
correct on the merits — it is not a mislabelled default.

**The cheapest useful outcome is §1 alone.** It is read-only, needs one credential, and there is a
real chance it returns zero and closes WIC-1464's remaining scope outright.

## Verification status of the underlying scripts

Both were re-validated against `main` on 2026-09-04, and the deliverables re-confirmed present on
`main` on 2026-09-05:

- `test/foreign-star-audit.predicate.test.ts` — 20/20 green; schema-drift gate 13/13 columns present.
- `test/migrate-project-storage-keys.test.ts` — 41/41 green; schema-drift gate 2/2 columns present.

Note the predicate suites build their own inline schema fixtures, so they stay green even if a
migration removed a column the real query needs — the column-presence checks above are therefore a
**separate, independent gate** and were run separately.

Source of record: WIC-1464 (foreign STAR text audit), WIC-1929 (project storage keys), WIC-1433
(the migration that made namespacing necessary), WIC-1449 / PR #153 (the read-scoping fix).
