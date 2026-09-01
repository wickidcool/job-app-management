// WIC-1464 (AC-a) — read-only audit of foreign STAR text already persisted in
// `resume_variants` and `interview_prep_stories`.
//
// Reports only. It performs no writes and cannot: every statement runs inside a
// `BEGIN READ ONLY` transaction, so the database itself rejects a write even if
// this script acquires one by mistake. That is the difference between a script
// that is documented read-only and one that is enforced read-only, and it is
// what makes running this against production safe while AC-b is still open.
//
//   DATABASE_URL=... node scripts/audit-foreign-star-text.mjs
//   DATABASE_URL=... node scripts/audit-foreign-star-text.mjs --json
//   DATABASE_URL=... node scripts/audit-foreign-star-text.mjs --samples 5
//
// `--samples N` prints N example rows per affected table. Those samples contain
// **the leaked text itself**, so they are off by default; do not paste the
// output of `--samples` into a ticket.
//
// The identification predicate, its three-way verdict, and the two corrections
// to the rule as WIC-1464 states it are documented in ./lib/foreign-star-audit.mjs.
import postgres from 'postgres';
import {
  VARIANT_BULLETS_SQL,
  STORY_BULLETS_SQL,
  VARIANT_SELECTED_BULLET_REFS_SQL,
  summarise,
  VERDICTS,
} from './lib/foreign-star-audit.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const sampleIdx = args.indexOf('--samples');
const sampleCount = sampleIdx === -1 ? 0 : Number(args[sampleIdx + 1] ?? 3);

const databaseUrl = process.env.DATABASE_URL ?? '';
if (!databaseUrl) {
  console.error('Error: DATABASE_URL is not set.');
  process.exit(1);
}
const isSupabase =
  databaseUrl.includes('supabase.co') || databaseUrl.includes('pooler.supabase.com');

function report(title, s) {
  const line = VERDICTS.map((v) => `${v}=${s.byVerdict[v]}`).join('  ');
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
  console.log(`  occurrences scanned      ${s.occurrences}`);
  console.log(`  by verdict               ${line}`);
  console.log(`  affected rows            ${s.affectedRows}`);
  console.log(`  distinct victim owners   ${s.distinctVictimOwners}  (their text was copied)`);
  console.log(`  distinct exposed-to      ${s.distinctExposedToOwners}  (can read the copy)`);
}

async function main() {
  const sql = postgres(databaseUrl, {
    max: 1,
    ssl: isSupabase ? 'require' : false,
    prepare: false,
  });
  try {
    // `BEGIN READ ONLY` — enforced by the server, not by convention.
    const { variantRows, storyRows, refRows } = await sql.begin('READ ONLY', async (tx) => ({
      variantRows: await tx.unsafe(VARIANT_BULLETS_SQL),
      storyRows: await tx.unsafe(STORY_BULLETS_SQL),
      refRows: await tx.unsafe(VARIANT_SELECTED_BULLET_REFS_SQL),
    }));

    const variants = summarise(variantRows, 'variant_id', 'variant_owner_id');
    const stories = summarise(storyRows, 'story_id', 'prep_owner_id');
    const refs = summarise(refRows, 'variant_id', 'variant_owner_id');

    // Union across both tables — the AC-a headline. A user victimised in both a
    // variant and a prep story is one victim, not two.
    const allVictims = new Set([...variants.victimOwnerIds, ...stories.victimOwnerIds]);
    const ownerMismatchedStories = storyRows.filter((r) => r.story_owner_matches_prep === false);

    if (asJson) {
      console.log(
        JSON.stringify(
          {
            issue: 'WIC-1464',
            resumeVariants: variants,
            interviewPrepStories: stories,
            selectedBulletRefs: refs,
            distinctVictimOwnersOverall: allVictims.size,
            storiesWhoseOwnerDisagreesWithPrep: ownerMismatchedStories.length,
          },
          null,
          2
        )
      );
    } else {
      report('resume_variants — embedded bullet text (all 3 carriers)', variants);
      report('interview_prep_stories — STAR narratives', stories);
      report('resume_variants.selected_bullets — id-only references (no text)', refs);
      console.log(`\ndistinct victim owners across both tables: ${allVictims.size}`);
      console.log(
        `interview_prep_stories whose own user_id disagrees with its prep: ${ownerMismatchedStories.length}`
      );
      if (variants.byVerdict.foreign === 0 && stories.byVerdict.foreign === 0) {
        console.log('\nNo confirmed cross-tenant text found. AC-b decision: nothing to remediate.');
      } else {
        console.log(
          '\nConfirmed cross-tenant text present. AC-b (delete / strip / regenerate) is a ' +
            'data-loss call on user-visible artefacts — route it to the board before AC-c runs.'
        );
      }
      if (variants.byVerdict.indeterminate > 0 || stories.byVerdict.indeterminate > 0) {
        console.log(
          "`indeterminate` = one side's owner is NULL or the 0017 placeholder. Not counted as " +
            'a leak; decide separately whether legacy/orphan rows are in scope.'
        );
      }
    }

    if (sampleCount > 0) {
      console.error('\n--- samples (CONTAIN LEAKED TEXT — do not paste into a ticket) ---');
      for (const r of variantRows.filter((r) => r.verdict === 'foreign').slice(0, sampleCount)) {
        console.error(`variant ${r.variant_id} [${r.carrier}] bullet ${r.bullet_id}`);
        console.error(`  owner ${r.variant_owner_id} <- bullet owner ${r.bullet_owner_id}`);
        console.error(`  text: ${String(r.bullet_text ?? '').slice(0, 160)}`);
      }
      for (const r of storyRows.filter((r) => r.verdict === 'foreign').slice(0, sampleCount)) {
        console.error(`story ${r.story_id} star_entry ${r.star_entry_id}`);
        console.error(`  prep owner ${r.prep_owner_id} <- bullet owner ${r.bullet_owner_id}`);
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
