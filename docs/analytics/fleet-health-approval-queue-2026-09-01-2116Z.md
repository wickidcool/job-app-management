# Fleet health: the board approval queue, 2026-09-01 21:16Z

Measured by the Data Analyst from `GET /api/companies/{companyId}/approvals` (n=96, a
complete census — see "Method"). All figures re-derivable with the snippet below.

## Headline

**The approval channel is healthy — 85 of 96 approvals (88.5%) have been decided. But an
approval that asks the human to *return a value* almost never gets the same-session fast
lane: 1 of 14, versus 31 of 71 for plain yes/no asks (Fisher exact, p = 0.014). The P1 prod
restore is sitting in that slow class.**

This is the opposite of the board *interactions* queue, where 76% of asks die unanswered
(`board-ask-hygiene`). Do not carry the pessimism from that channel over to this one.
Approvals get answered. What varies is *how fast*, and the discriminator is the shape of
the ask — not its priority, and not its age.

## Approvals get decided

| status | n | share |
|---|---|---|
| approved | 80 | 83.3% |
| pending | 11 | 11.5% |
| rejected | 5 | 5.2% |

Time-to-decision, n=85 decided: **median 14.7h**, mean 68.0h.
p10 0.03h · p25 0.44h · p75 71.5h · p90 190.2h · max 442.8h.

The distribution is strongly bimodal, mirroring the PR backlog finding
(`fleet-health-pr-backlog-2026-08-30-0540Z.md`): **29% are decided inside an hour** (p10 is
under two minutes), and then a long tail. Decisions arrive in bursts — 14 on 08-27, 10 on
08-20, 9 on 08-12, 4 on 09-01 — separated by multi-day silences.

## The finding: compound asks miss the fast lane

Classify each approval by its `recommendedAction`. A **compound** ask requires the human to
return a value or verify an external fact ("reply with the id", "confirm the token scope",
"provide…"). A **simple** ask is approve/reject on its own contents.

| class | n decided | median latency | decided <6h | ever rejected |
|---|---|---|---|---|
| simple | 71 | 12.9h | **31 (43.7%)** | 1 (1.4%) |
| compound | 14 | 16.5h | **1 (7.1%)** | **4 (28.6%)** |

Two separate effects, and the first is easy to miss:

1. **The medians barely differ (12.9h vs 16.5h).** The damage is not to average latency —
   it is that compound asks are excluded from the fast lane where 44% of simple asks are
   resolved. Fisher exact two-sided on 1/14 vs 31/71: **p = 0.0136**.
2. **Compound asks carry 4 of the company's 5 all-time rejections.** A 29% rejection rate
   against 1.4% for simple asks. Bundling a question into an approval does not just delay
   it; it materially raises the chance the whole thing comes back "no".

The three slowest compound asks (329.9h, 355.7h, 359.5h) were **all rejected**, and all
three were credential-provision asks — "provide/authorize a valid CF token", "prod points
at a DELETED Supabase project — provide…", "Replenish Gemini credits".

### The honest counter-example

The *fastest* compound ask in the dataset — 0.4h, approved — was
"Provide CLOUDFLARE_API_TOKEN to DevOps agent". So credential asks are **not** uniformly
doomed, and the mechanism is not "the board refuses credential work". Something else
separates the 0.4h grant from the 330h refusals, and n=14 is too small to say what.

## Why this matters right now: the P1 is in the slow class

`d61d200b` — *"P1 prod restore: add a production Hyperdrive binding (ADR-007 opt 1) +
deploy"*, filed by DevOps `288abc97` at 2026-09-01T02:07:24Z — is **compound**. Its
`recommendedAction` is:

> APPROVE the production Hyperdrive deploy AND either (i) confirm the CI
> `CLOUDFLARE_API_TOKEN` has `Hyperdrive:Edit` scope … or (ii) create the `jobtrail-prod`
> Hyperdrive config in the CF console and reply with its id.

So one artifact carries a **go/no-go** and a **console errand that returns a value**. Per
the table above, that is the shape that misses the fast lane and attracts rejections.

**It has already been passed over once.** The board's most recent session decided four
approvals at 02:19:19, 02:21:16, 02:28:15 and 02:29:35 — all *after* `d61d200b` was created
at 02:07:24. All four were simple. The P1 was in the queue throughout and was not actioned.

Prod has been down ~6 days (root `GET /health` → 503 `hyperdrive:false`, re-verified this
run at 21:16Z).

### Queue state, all 11 pending

| id | age | class | ask |
|---|---|---|---|
| `c2096ff6` | 135.7h | COMPOUND | merge WIC-1625 stranded-PR-sweep guard |
| `27cfdbe4` | 78.9h | simple | break the fleet spend-cap deadlock |
| `becf9d77` | 74.2h | simple | deploy WIC-1686 skip-ci guard |
| `ae7b7f26` | 71.6h | simple | clear 13 mechanical CONFLICTING PRs |
| `b60bf5ba` | 69.9h | simple | WIC-1712 conflict resolution to PR #154 |
| `472c540b` | 68.2h | simple | WIC-1736 preview Hyperdrive creds |
| `528a37b1` | 59.3h | simple | WIC-1792 changelog union detector |
| `bd1124ab` | 49.1h | simple | merge PR #289 (WIC-1845) |
| `d827ce9e` | 48.8h | simple | merge WIC-1877 `[skip deploy]` marker |
| `5fc5ea43` | 47.3h | COMPOUND | preview deploys: un-skip #303 + open PR |
| **`d61d200b`** | **19.1h** | **COMPOUND** | **P1 prod restore — Hyperdrive binding** |

**Nothing here is provably dead.** The oldest pending is 135.7h, and 16 of the 85 decided
approvals took longer than that before landing. This queue is stalled, not abandoned — which
is precisely why it should not be re-filed. Re-filing resets age and adds queue depth.

## Recommendation

**For the board — the cheapest path to prod restore is to split the decision, not to answer
all of it.** The go/no-go on the Hyperdrive deploy is settled engineering: ADR-007 option 1,
decided and closed on WIC-1473, and preview already runs this configuration. Approving that
half costs nothing that the console errand costs, and it lets DevOps proceed to whichever of
(i)/(ii) turns out to be available. Holding the whole artifact until someone is at a
Cloudflare console is what puts a P1 into the 330h class.

**For agents filing approvals — file the go/no-go and the errand as two artifacts.** One
approval should have exactly one answer. If you need a value back, that is a separate ask,
and bundling it costs you the fast lane (1/14) and a 29% rejection rate.

**Do not withdraw or re-file `d61d200b`.** It is correct as written (the region question was
re-validated and closed on WIC-1933), and only its requester can resubmit it, only from
`revision_requested`, which only the board can set. There is no amend route
(`approval-head-drift`). The action here is a board decision, not another card.

## Limitations

- **n=14 compound decided.** The fast-lane gap clears p<0.05 but rests on a small cell; the
  rejection-rate gap (4/14) is smaller still. Treat both as directional.
- **The classifier is a regex** over `recommendedAction` (`reply with`, `hand back`,
  `confirm`, `provide the`, `paste`, `respond with`, `and its id`, …), not a judgement. All
  14 compound-decided rows are listed in the Method output so the labels are auditable.
- **Correlation, not mechanism.** Compound asks may be slower *because* they are compound,
  or because the kind of work that needs a value back is independently harder. This data
  cannot separate those.
- Latency is measured `createdAt` → `decidedAt`. It cannot distinguish "the board did not
  see it" from "the board saw it and deferred".

## Method

```python
import json, datetime, re, statistics, urllib.request
B = API_URL.rstrip('/').removesuffix('/api')
rows = json.load(urllib.request.urlopen(urllib.request.Request(
    f"{B}/api/companies/{COMPANY_ID}/approvals?limit=1000",
    headers={"Authorization": f"Bearer {API_KEY}"})))
# 96 rows returned against limit=1000 -> short page, so this is a complete census,
# not a truncated read (cf. fleet-guidance:list-endpoint-truncation).
P = lambda s: datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
PAT = re.compile(r"reply with|hand back|confirm (?:that |whether |the )?|provide the|paste|"
                 r"tell (?:me|us)|respond with|and its id|report back|let (?:me|us) know", re.I)
compound = lambda r: bool(PAT.search(str((r.get('payload') or {}).get('recommendedAction', ''))))
lat = lambda r: (P(r['decidedAt']) - P(r['createdAt'])).total_seconds() / 3600
```

`approvals` is **not** subject to the priority-ordered truncation that affects
`GET .../issues`: it returned 96 rows against `limit=1000`, and a short page is the honest
terminator. No `offset` walk was needed.

Source of record: WIC-1386 (the P1), WIC-1473 / ADR-007 (the settled design), WIC-1611
(approvals carry no head SHA and have no amend route).
