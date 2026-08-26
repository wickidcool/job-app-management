// WIC-1464 (AC-a / AC-c) — identification predicate for foreign STAR text that
// WIC-1449 / PR #153 could not reach.
//
// PR #153 scoped every *read* of `quantified_bullets` to the caller, so no new
// cross-tenant STAR text enters the system. Two artefacts of the open period
// survive that, because both hold a **copy** of the text rather than a
// reference, and a scoped read cannot hide a copy:
//
//   1. `resume_variants` — the model's rewritten bullet text is embedded inline
//      as `bullets[].text`, with `bullets[].id` still pointing at the source row.
//   2. `interview_prep_stories` — `oneMinVersion` / `twoMinVersion` /
//      `fiveMinVersion` narratives derived from a foreign bullet, with
//      `star_entry_id` pointing at it.
//
// The SQL lives here, not in the CLI, so that the predicate tests
// (`test/foreign-star-audit.predicate.test.ts`) execute the query that actually
// ships. A test over a re-typed copy of the SQL grades the copy.
//
// ---------------------------------------------------------------------------
// Two corrections to the identification rule as WIC-1464 states it
// ---------------------------------------------------------------------------
//
// (1) The card says "both sides can legitimately be NULL (the unauthenticated
//     local-dev path writes user_id = NULL); NULL <> NULL is not a mismatch".
//     That is only half true against the schema that is actually deployed.
//     Migration `0017_enforce_userid_not_null.sql` made
//     `quantified_bullets.user_id` **NOT NULL**, and it did not leave the
//     pre-existing NULLs alone — step 1 rewrote every one of them to the
//     placeholder `00000000-0000-0000-0000-000000000000`, documented there as
//     "orphaned/legacy data". `resume_variants.user_id`,
//     `interview_preps.user_id` and `interview_prep_stories.user_id` were *not*
//     included in 0017 and remain nullable.
//
//     So the bullet side is never NULL, and the NULL-vs-NULL case the card
//     warns about cannot arise on the join at all. The case that *does* arise —
//     and that a naive `<>` gets wrong in the opposite direction, by
//     over-reporting — is placeholder-vs-NULL and placeholder-vs-real. Both
//     NULL and the placeholder mean "no known owner", so both are normalised to
//     NULL before comparison (`NORMALISED_OWNER` below) and compared with
//     `IS NOT DISTINCT FROM`.
//
// (2) A row is not classified by a boolean. Three outcomes are materially
//     different and the AC-b decision needs them apart, because only the first
//     is a confirmed cross-tenant leak:
//
//       foreign        two *known*, distinct owners. This is the leak.
//       indeterminate  exactly one side has a known owner; the other is NULL or
//                      the 0017 placeholder. Cannot be confirmed as two distinct
//                      users, and must not be counted as one.
//       matched        same known owner, or neither side has a known owner.
//       unresolved     the id resolves to no `quantified_bullets` row (deleted
//                      source). The copied text is still frozen in place, but
//                      there is no live row left to attribute it to.
//
// ---------------------------------------------------------------------------
// Carriers
// ---------------------------------------------------------------------------
//
// WIC-1464 names `content->'experience'->...->'bullets'`. That is one of three
// places a `BulletContent[]` is persisted on a variant (see `db/schema.ts`):
//
//   * `content.experience[].bullets[]`                     (named on the card)
//   * `content.projects[].bullets[]`                       (ProjectSection also
//                                                            carries BulletContent[])
//   * `revision_history[].previousContent.{experience,projects}[].bullets[]`
//     (VariantRevisionEntry.previousContent is a whole frozen ResumeContent)
//
// Auditing only the first would undercount, and — worse for AC-c — a remediation
// built from that count would leave the same text sitting in `revision_history`.
// All three are enumerated. `selected_bullets[].bulletIds` is deliberately *not*
// a carrier: it holds ids with no text, so it is a dangling reference rather
// than a copy of foreign text. It is reported separately by the CLI.

/** 0017_enforce_userid_not_null.sql step 1: stand-in owner for legacy NULL rows. */
export const UNATTRIBUTED_OWNER = '00000000-0000-0000-0000-000000000000';

/**
 * NULL and the 0017 placeholder both mean "no known owner". Collapse them so a
 * comparison is between *known* identities or nothing at all.
 */
const norm = (expr) => `NULLIF(${expr}, '${UNATTRIBUTED_OWNER}'::uuid)`;

/**
 * `jsonb_array_elements` raises `cannot extract elements from a scalar` on any
 * non-array input, which would abort the whole audit on a single malformed row.
 * Degrade to an empty array instead — a row we cannot parse contributes nothing
 * rather than taking the report down with it.
 */
const arr = (expr) => `CASE WHEN jsonb_typeof(${expr}) = 'array' THEN ${expr} ELSE '[]'::jsonb END`;

/**
 * Classify a (container owner, bullet owner) pair. `bulletIdExpr` is used only
 * to detect a failed LEFT JOIN.
 */
const verdict = (containerOwner, bulletOwner, joinedIdExpr) => `
  CASE
    WHEN ${joinedIdExpr} IS NULL THEN 'unresolved'
    WHEN ${norm(bulletOwner)} IS NOT DISTINCT FROM ${norm(containerOwner)} THEN 'matched'
    WHEN ${norm(bulletOwner)} IS NULL OR ${norm(containerOwner)} IS NULL THEN 'indeterminate'
    ELSE 'foreign'
  END`;

/**
 * Every `BulletContent` occurrence on every resume variant, classified.
 *
 * Grain is one row per *occurrence*, not per variant — a single variant can
 * carry the same foreign bullet in `content` and again in several
 * `revision_history` entries, and the remediation in AC-c has to visit each.
 */
export const VARIANT_BULLETS_SQL = `
WITH variant_sections AS (
  SELECT v.id AS variant_id, v.user_id AS owner_id,
         'content.experience'::text AS carrier, sec AS section
  FROM resume_variants v
  CROSS JOIN LATERAL jsonb_array_elements(${arr("v.content->'experience'")}) AS sec

  UNION ALL

  SELECT v.id, v.user_id, 'content.projects'::text, sec
  FROM resume_variants v
  CROSS JOIN LATERAL jsonb_array_elements(${arr("v.content->'projects'")}) AS sec

  UNION ALL

  SELECT v.id, v.user_id, ('revision_history.previousContent.' || ks.k)::text, sec
  FROM resume_variants v
  CROSS JOIN LATERAL jsonb_array_elements(${arr('v.revision_history')}) AS rev
  CROSS JOIN LATERAL (VALUES ('experience'), ('projects')) AS ks(k)
  CROSS JOIN LATERAL jsonb_array_elements(
    ${arr("rev->'previousContent'->ks.k")}
  ) AS sec
),
variant_bullets AS (
  SELECT vs.variant_id, vs.owner_id, vs.carrier,
         b->>'id' AS bullet_id,
         b->>'text' AS bullet_text
  FROM variant_sections vs
  CROSS JOIN LATERAL jsonb_array_elements(${arr("vs.section->'bullets'")}) AS b
  WHERE b->>'id' IS NOT NULL
)
SELECT vb.variant_id,
       vb.owner_id AS variant_owner_id,
       vb.carrier,
       vb.bullet_id,
       vb.bullet_text,
       qb.user_id AS bullet_owner_id,
       ${verdict('vb.owner_id', 'qb.user_id', 'qb.id')} AS verdict
FROM variant_bullets vb
LEFT JOIN quantified_bullets qb ON qb.id = vb.bullet_id`;

/**
 * Every interview prep story, classified against the owner of its *prep*.
 *
 * The card specifies `interview_preps.user_id` as the container owner, and that
 * is the authoritative one — the story row is a child of the prep. But
 * `interview_prep_stories` carries its own nullable `user_id` too, so the two
 * can disagree; `story_owner_matches_prep` surfaces that separately instead of
 * silently picking one.
 */
export const STORY_BULLETS_SQL = `
SELECT s.id AS story_id,
       s.interview_prep_id,
       p.user_id AS prep_owner_id,
       s.user_id AS story_owner_id,
       s.star_entry_id,
       qb.user_id AS bullet_owner_id,
       ${verdict('p.user_id', 'qb.user_id', 'qb.id')} AS verdict,
       (${norm('s.user_id')} IS NOT DISTINCT FROM ${norm('p.user_id')}) AS story_owner_matches_prep
FROM interview_prep_stories s
JOIN interview_preps p ON p.id = s.interview_prep_id
LEFT JOIN quantified_bullets qb ON qb.id = s.star_entry_id`;

/**
 * `selected_bullets[].bulletIds` holds ids with no accompanying text. Not a copy
 * of foreign text, so not part of the leak count — but a foreign id here is a
 * dangling cross-tenant reference, and PR #153 means it now resolves to nothing
 * on read. Reported so AC-b is not made without it.
 */
export const VARIANT_SELECTED_BULLET_REFS_SQL = `
WITH refs AS (
  SELECT v.id AS variant_id, v.user_id AS owner_id, bid AS bullet_id
  FROM resume_variants v
  CROSS JOIN LATERAL jsonb_array_elements(${arr('v.selected_bullets')}) AS selection
  CROSS JOIN LATERAL jsonb_array_elements_text(
    ${arr("selection->'bulletIds'")}
  ) AS bid
)
SELECT refs.variant_id,
       refs.owner_id AS variant_owner_id,
       refs.bullet_id,
       qb.user_id AS bullet_owner_id,
       ${verdict('refs.owner_id', 'qb.user_id', 'qb.id')} AS verdict
FROM refs
LEFT JOIN quantified_bullets qb ON qb.id = refs.bullet_id`;

/** Verdicts in report order. `foreign` first because it is the only leak. */
export const VERDICTS = ['foreign', 'indeterminate', 'matched', 'unresolved'];

/**
 * Roll occurrence-grain rows up into the figures AC-a asks for. Pure, so the
 * summary is testable without a database.
 *
 * @param rows       occurrence rows from one of the SQL constants above
 * @param containerKey  column identifying the containing row (`variant_id` / `story_id`)
 * @param ownerKey      column holding the container's owner
 */
export function summarise(rows, containerKey, ownerKey) {
  const byVerdict = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
  const affectedContainers = new Set();
  // The victim is the bullet's owner: their text was copied into someone else's
  // artefact. The exposed-to party is the container's owner, who can read it.
  const victimOwners = new Set();
  const exposedToOwners = new Set();

  for (const row of rows) {
    byVerdict[row.verdict] = (byVerdict[row.verdict] ?? 0) + 1;
    if (row.verdict !== 'foreign') continue;
    affectedContainers.add(row[containerKey]);
    if (row.bullet_owner_id) victimOwners.add(row.bullet_owner_id);
    if (row[ownerKey]) exposedToOwners.add(row[ownerKey]);
  }

  return {
    occurrences: rows.length,
    byVerdict,
    affectedRows: affectedContainers.size,
    distinctVictimOwners: victimOwners.size,
    distinctExposedToOwners: exposedToOwners.size,
    victimOwnerIds: [...victimOwners].sort(),
    exposedToOwnerIds: [...exposedToOwners].sort(),
  };
}
