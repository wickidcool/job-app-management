// WIC-1408 — read-only census of `catalog_diffs` rows with no reachable owner.
//
// The card's first instruction is "count first — this may be an empty set in
// practice". This module holds that count, and it is exported rather than
// inlined into the CLI so the test can run *this* SQL rather than grade a
// retyped copy of it. The predicate is three-valued logic over a nullable uuid
// crossed with a correlated lookup that can miss; a stub db that resolves
// whatever rows it was primed with certifies any predicate at all, including no
// predicate. That failure mode has shipped here before.

/** Migration 0017 step 1's stand-in owner for rows that had none. */
export const ORPHAN_OWNER = '00000000-0000-0000-0000-000000000000';

/**
 * The two `trigger_source` values `processCatalogChange` writes
 * (`extraction.service.ts` — `event.sourceType === 'resume' ? 'resume_upload' :
 * 'app_change'`). Anything else in the column came from somewhere this census
 * does not model, so it is counted on its own line rather than folded into
 * "unrecoverable".
 */
export const KNOWN_TRIGGER_SOURCES = ['resume_upload', 'app_change'];

/**
 * One row of counts describing every `catalog_diffs` row with `user_id IS NULL`.
 *
 * `source_owner` is looked up through `trigger_id` — `resumes.id` for
 * `resume_upload`, `applications.id` for `app_change`. `source_exists`
 * distinguishes "the source row is gone" from "the source row is here and is
 * itself unowned", which are different outcomes: the first is unrecoverable
 * forever, the second becomes recoverable the moment that resume or application
 * gets an owner. Collapsing them would hide that.
 */
export const ORPHAN_CENSUS_SQL = `
WITH orphan AS (
  SELECT
    d.id,
    d.trigger_source,
    d.status::text AS status,
    d.created_at,
    CASE d.trigger_source
      WHEN 'resume_upload' THEN EXISTS (SELECT 1 FROM resumes r WHERE r.id = d.trigger_id)
      WHEN 'app_change'    THEN EXISTS (SELECT 1 FROM applications a WHERE a.id = d.trigger_id)
      ELSE false
    END AS source_exists,
    CASE d.trigger_source
      WHEN 'resume_upload' THEN (SELECT r.user_id FROM resumes r WHERE r.id = d.trigger_id)
      WHEN 'app_change'    THEN (SELECT a.user_id FROM applications a WHERE a.id = d.trigger_id)
      ELSE NULL
    END AS source_owner
  FROM catalog_diffs d
  WHERE d.user_id IS NULL
),
classified AS (
  SELECT
    o.*,
    (o.trigger_source NOT IN ('resume_upload', 'app_change')) AS unknown_source,
    (
      o.trigger_source IN ('resume_upload', 'app_change')
      AND o.source_exists
      AND o.source_owner IS NOT NULL
      AND o.source_owner <> '${ORPHAN_OWNER}'::uuid
    ) AS recoverable
  FROM orphan o
)
SELECT
  (SELECT count(*) FROM catalog_diffs)                                      AS diffs_total,
  count(*)                                                                  AS unowned_total,
  count(*) FILTER (WHERE recoverable AND trigger_source = 'resume_upload')  AS recoverable_via_resumes,
  count(*) FILTER (WHERE recoverable AND trigger_source = 'app_change')     AS recoverable_via_applications,
  count(*) FILTER (WHERE NOT recoverable AND NOT unknown_source AND NOT source_exists)
                                                                            AS source_row_missing,
  count(*) FILTER (WHERE NOT recoverable AND NOT unknown_source AND source_exists)
                                                                            AS source_row_unowned,
  count(*) FILTER (WHERE unknown_source)                                    AS unknown_trigger_source,
  count(*) FILTER (WHERE recoverable AND status = 'pending')                AS recoverable_pending,
  count(DISTINCT CASE WHEN recoverable THEN source_owner END)               AS affected_users,
  min(created_at)                                                           AS oldest_created_at,
  max(created_at)                                                           AS newest_created_at
FROM classified
`;

/**
 * The pre-0017 cohort, reported separately and never touched by migration 0020.
 * 0017 step 1 stamped the placeholder onto every `catalog_diffs` row that was
 * NULL at the time. Those rows are just as unreachable, and just as recoverable
 * through `trigger_id` — but they are a different cause with a different owner
 * decision behind them, so this prints the number and leaves the call to a human.
 */
export const PLACEHOLDER_CENSUS_SQL = `
SELECT
  count(*) AS placeholder_total,
  count(*) FILTER (
    WHERE (
      d.trigger_source = 'resume_upload'
      AND EXISTS (SELECT 1 FROM resumes r
                   WHERE r.id = d.trigger_id
                     AND r.user_id IS NOT NULL
                     AND r.user_id <> '${ORPHAN_OWNER}'::uuid)
    ) OR (
      d.trigger_source = 'app_change'
      AND EXISTS (SELECT 1 FROM applications a
                   WHERE a.id = d.trigger_id
                     AND a.user_id IS NOT NULL
                     AND a.user_id <> '${ORPHAN_OWNER}'::uuid)
    )
  ) AS placeholder_recoverable
FROM catalog_diffs d
WHERE d.user_id = '${ORPHAN_OWNER}'::uuid
`;

const int = (v) => Number(v ?? 0);

/**
 * Render the two census rows as text. Returns `{ text, backfillWouldRecover }`
 * so a caller can gate on the number instead of parsing prose — the CLI exits
 * non-zero-free either way, but the gate is what the card asked for.
 */
export function summarise(census, placeholder) {
  const recoverable = int(census.recoverable_via_resumes) + int(census.recoverable_via_applications);
  const lines = [
    `catalog_diffs rows total ............... ${int(census.diffs_total)}`,
    `  with user_id IS NULL ................. ${int(census.unowned_total)}`,
    '',
    'Of the unowned rows, migration 0020 would recover:',
    `  via resumes (resume_upload) .......... ${int(census.recoverable_via_resumes)}`,
    `  via applications (app_change) ........ ${int(census.recoverable_via_applications)}`,
    `  ------------------------------------- ${recoverable}`,
    `  of which still 'pending' ............. ${int(census.recoverable_pending)}`,
    `  distinct owners restored to .......... ${int(census.affected_users)}`,
    '',
    'and would deliberately leave alone:',
    `  source row deleted ................... ${int(census.source_row_missing)}`,
    `  source row itself unowned ............ ${int(census.source_row_unowned)}`,
    `  unrecognised trigger_source .......... ${int(census.unknown_trigger_source)}`,
    '',
    `Unowned rows span ${census.oldest_created_at ?? 'n/a'} .. ${census.newest_created_at ?? 'n/a'}`,
    '',
    'Out of scope for 0020 — the pre-0017 cohort carrying the placeholder owner:',
    `  placeholder-owned rows ............... ${int(placeholder.placeholder_total)}`,
    `  of those, recoverable the same way ... ${int(placeholder.placeholder_recoverable)}`,
  ];
  if (recoverable === 0) {
    lines.push(
      '',
      'NOTHING TO RECOVER. Migration 0020 is a no-op against this database — it',
      'still runs, still records itself, and still costs nothing. Treat this as the',
      "card's zero-row answer, not as a reason to hold the deploy."
    );
  }
  return { text: lines.join('\n'), backfillWouldRecover: recoverable };
}
