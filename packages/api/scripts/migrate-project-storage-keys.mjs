// WIC-1433: relocate project artefacts from the shared slug-only prefix to the
// owner-namespaced one.
//
//   legacy   projects/{slug}/{file}            <- shared by every user holding {slug}
//   current  projects/{userId}/{slug}/{file}
//
// **This script will not guess.** The DB row that owns a slug is the mapping,
// and after migration 0017 dropped the global unique on `projects.slug` a slug
// may be held by more than one user. For those, the legacy directory is a
// commingling of two people's files with nothing in the object store recording
// who wrote what — that is a human call, not a heuristic. Such slugs are
// reported and left exactly where they are, and the script exits non-zero so a
// deploy cannot mistake "partially migrated" for "done".
//
// Dry-run by default. Pass --apply to actually copy and delete.
//
//   DATABASE_URL=... R2_ENDPOINT=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//   R2_BUCKET=... node scripts/migrate-project-storage-keys.mjs [--apply]
//
// Local dev data (`{dataDir}/projects/{slug}`) instead of R2:
//
//   DATABASE_URL=... node scripts/migrate-project-storage-keys.mjs --local ./data [--apply]
//
// Idempotent: a second run finds no legacy keys and exits 0. A legacy file
// whose namespaced destination is already occupied is *never* moved — that is
// an overwrite plus an unrecoverable delete, not a migration — so it too is
// reported and left in place behind a non-zero exit.
import postgres from 'postgres';
import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const APPLY = process.argv.includes('--apply');
const localIdx = process.argv.indexOf('--local');
const LOCAL_DIR = localIdx === -1 ? null : process.argv[localIdx + 1];

/**
 * The **userId** set, derived from the slug map — in one place, on purpose.
 *
 * Both enumerators need to recognise a userId, and `owners` is keyed by *slug*.
 * Deriving that set at each call site is what the WIC-1433 round-2 defects both
 * were: one caller passed `owners.has(name)` (the slug set) where a userId set
 * was meant, and the failure was silent — every legacy directory skipped, zero
 * legacy files reported, "all attributable", exit 0, every file still on the
 * shared cross-tenant prefix.
 *
 * So the enumerators take the slug map itself and call this, and this is the
 * only `.values()`/`.keys()` decision in the script. Passing a pre-derived set
 * is refused rather than silently honoured: a `Set` answers `.values()` too, so
 * the wrong argument would otherwise sail through and produce exactly the
 * original bug. A loud throw is the whole point — the one outcome this script
 * exists to prevent is a success exit that means its own opposite.
 */
export function ownerIdsOf(owners) {
  if (!(owners instanceof Map)) {
    throw new TypeError(
      'ownerIdsOf expects the slug -> [userId] Map from ownersBySlug, not a pre-derived set. ' +
        'Passing the slug set here is the WIC-1433 defect: it inverts every membership test ' +
        'and makes a purely-legacy tree enumerate as empty.'
    );
  }
  return new Set([...owners.values()].flat());
}

/**
 * Legacy vs already-migrated.
 *
 *   projects/index.md                    2 -> legacy index (derived, delete)
 *   projects/{slug}/{file}               3 -> legacy
 *   projects/{userId}/index.md           3 -> per-owner index (derived, leave)
 *   projects/{userId}/{slug}/{file}      4 -> already namespaced
 *
 * Segment count alone very nearly decides it. A project *file* name can never
 * contain `/` — `project.service.validateFileName` rejects `..`, `/` and `\` —
 * so a legacy slug directory is always exactly one level deep, and no
 * *file* key is ambiguous between the two shapes.
 *
 * The exception is the per-owner index this same change introduced:
 * `generateProjectIndex` writes `projects/{userId}/index.md`
 * (`project.service.ts`, via `ownerProjectsPrefix`), which has three segments
 * just like a legacy key. Reading it as legacy makes every post-migration
 * index an orphan and pins the exit code at 2 forever — destroying the one
 * signal this script exists to give, since an operator could no longer tell a
 * genuinely commingled slug from a benign derived artefact.
 *
 * `ownerIds` (the *userId* set, not the slug set) is what separates them.
 * Without it the caller gets the old segment-count-only behaviour, which is
 * correct for every shape except that index — so a legacy project file
 * legitimately named `index.md` is still classified legacy, as it must be.
 *
 * Exported so `test/migrate-project-storage-keys.test.ts` pins it.
 */
export function classify(key, ownerIds = new Set()) {
  const parts = key.split('/');
  if (parts[0] !== 'projects') return { kind: 'foreign' };
  if (parts.length === 2) return { kind: 'legacy-index' }; // projects/index.md
  if (parts.length === 3) {
    if (parts[2] === 'index.md' && ownerIds.has(parts[1])) return { kind: 'namespaced' };
    return { kind: 'legacy', slug: parts[1], fileName: parts[2] };
  }
  return { kind: 'namespaced' };
}

/** The owner-namespaced key a legacy artefact belongs at. */
export function destKey(item) {
  return `projects/${item.userId}/${item.slug}/${item.fileName}`;
}

/**
 * Refuse to move anything whose destination is already occupied.
 *
 * `--apply` copies then *deletes the source*, so an occupied destination is
 * not a merge — it is one file overwriting another and the loser being
 * unrecoverable. It happens whenever a user has written to a project since the
 * fix shipped: the new bytes live at the namespaced key while their pre-fix
 * bytes still sit at the legacy one, so migrating would replace current
 * content with stale content and then delete the evidence.
 *
 * Like a commingled slug, this is a human call, so it is reported and counted
 * into the non-zero exit rather than guessed at. Pure and exported so it is
 * testable without a backend.
 */
export function splitCollisions(movable, existingKeys) {
  const moves = [];
  const collisions = [];
  for (const m of movable) {
    const dest = destKey(m);
    (existingKeys.has(dest) ? collisions : moves).push({ ...m, dest });
  }
  return { moves, collisions };
}

/**
 * Split legacy files into what we can place and what a human must adjudicate.
 * `owners` is slug -> [userId, ...] read from the `projects` table, the only
 * authority on who owns a slug. Exported for the same reason as `classify`.
 */
export function bucketByOwnership(legacy, owners) {
  const movable = [];
  const commingled = new Map();
  const orphaned = new Map();
  for (const item of legacy) {
    const slugOwners = owners.get(item.slug) ?? [];
    if (slugOwners.length === 1) {
      movable.push({ ...item, userId: slugOwners[0] });
    } else if (slugOwners.length > 1) {
      // Already commingled: two users' files share this directory and nothing
      // in the object store records who wrote what. Never guess.
      if (!commingled.has(item.slug)) commingled.set(item.slug, { owners: slugOwners, files: [] });
      commingled.get(item.slug).files.push(item.fileName);
    } else {
      if (!orphaned.has(item.slug)) orphaned.set(item.slug, []);
      orphaned.get(item.slug).push(item.fileName);
    }
  }
  return { movable, commingled, orphaned };
}

/**
 * The R2 side of enumeration: turn a flat key listing into the same three
 * buckets `enumerateLocal` returns.
 *
 * Lifted out of `main()` because that is where it was, untested, and where
 * round-2 defect #1 lived: calling `classify(key)` without the owner id set
 * reads every per-owner `projects/{userId}/index.md` as a legacy key, which
 * makes it an orphan and pins the exit code at 2 forever — destroying the
 * signal the non-zero exit exists to carry. Taking `owners` (the slug map)
 * rather than a pre-derived id set means the caller has nothing to get wrong.
 */
export function planFromKeys(keys, owners) {
  const ownerIds = ownerIdsOf(owners);
  const legacy = [];
  const legacyIndexes = [];
  const existingKeys = new Set();
  for (const key of keys) {
    const c = classify(key, ownerIds);
    if (c.kind === 'legacy') legacy.push({ key, slug: c.slug, fileName: c.fileName });
    else if (c.kind === 'legacy-index') legacyIndexes.push(key);
    // Already-namespaced keys are the collision set: `splitCollisions` needs
    // them to see a destination that is already occupied. Dropping them here
    // silently re-enables the overwrite-plus-unrecoverable-delete this script
    // refuses to perform.
    else if (c.kind === 'namespaced') existingKeys.add(key);
  }
  return { legacy, legacyIndexes, existingKeys };
}

async function listAllKeys(s3, bucket) {
  const keys = [];
  let token;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: 'projects/', ContinuationToken: token })
    );
    for (const o of res.Contents ?? []) keys.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/**
 * `readdir`, tolerating a directory that is not there and nothing else.
 *
 * The `.catch(() => [])` this replaces swallowed `EACCES` exactly like
 * `ENOENT`, so an unreadable legacy directory enumerated as empty and the run
 * went on to report "All legacy project artefacts are attributable" and exit 0
 * with those files still on the shared prefix — the same false clean the owner
 * id set exists to prevent, reached by a different road.
 *
 * This deliberately reverses `c1b50f9`, which widened the already-migrated
 * branch to catch-all so one unreadable directory could not abort the walk.
 * Aborting is the safe direction here: this script's entire product is a
 * trustworthy answer to "is the move complete?", and an operator who sees a
 * crash re-runs it, while one who sees exit 0 does not.
 */
async function readdirOrEmpty(dir, options) {
  try {
    return await fs.readdir(dir, options);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Enumerate the local dev tree at `{dataDir}/projects`.
 *
 * Takes `owners` — the slug -> [userId] map — and derives the userId set via
 * `ownerIdsOf`, which is what tells an already-migrated `projects/{userId}/…`
 * subtree from a legacy `projects/{slug}/…` one. It used to take that set
 * pre-derived, and a caller passing the *slug* set instead inverts both
 * branches: every already-migrated tree gets walked as though it were legacy
 * (its slug directories enumerated as *files*), and — far worse — every
 * genuinely legacy directory is skipped, so a run over a purely-legacy tree
 * enumerates nothing, reports zero unresolved slugs and exits 0 having migrated
 * nothing. A success exit that means the opposite of what it says is the one
 * outcome this script is built to prevent, so the argument that could carry it
 * no longer exists.
 *
 * Returns the legacy files, the legacy global index, and the already-namespaced
 * keys (so `splitCollisions` can see an occupied destination without a second
 * pass over the disk).
 *
 * Exported for `test/migrate-project-storage-keys.test.ts`: this walk used to
 * live inline in `main()` with no cover at all, which is exactly how an
 * inverted membership test survived a full green suite.
 */
export async function enumerateLocal(root, owners) {
  const ownerIds = ownerIdsOf(owners);
  const legacy = [];
  const legacyIndexes = [];
  const existingKeys = new Set();
  const entries = await readdirOrEmpty(root, { withFileTypes: true });
  for (const e of entries) {
    // A directory named for a *user id* is an already-migrated tree, not a slug.
    if (e.isDirectory() && ownerIds.has(e.name)) {
      const subdirs = await readdirOrEmpty(path.join(root, e.name), { withFileTypes: true });
      for (const slug of subdirs) {
        if (!slug.isDirectory()) continue; // e.g. the per-owner index.md
        for (const f of await readdirOrEmpty(path.join(root, e.name, slug.name))) {
          existingKeys.add(`projects/${e.name}/${slug.name}/${f}`);
        }
      }
      continue;
    }
    if (e.isFile() && e.name === 'index.md') {
      legacyIndexes.push(path.join(root, e.name));
      continue;
    }
    if (!e.isDirectory()) continue;
    // Anything that is not a known owner id is treated as a legacy slug dir.
    const files = await readdirOrEmpty(path.join(root, e.name));
    for (const f of files) {
      legacy.push({ key: path.join(root, e.name, f), slug: e.name, fileName: f });
    }
  }
  return { legacy, legacyIndexes, existingKeys };
}

/**
 * Pick a backend and enumerate it — the wiring that used to sit inline in
 * `main()`, where nothing could reach it.
 *
 * This exists as its own exported function for one reason: making the wrong
 * argument unpassable fixes the *silent* failure, but it does not make the
 * call site *testable*, and both WIC-1433 round-2 defects were call-site
 * defects. While this branch lived in `main()` a mutant that handed
 * `enumerateLocal` the slug set could not red any test, because no test can
 * call `main()` — it opens a database connection and calls `process.exit`.
 * Lifting the branch out leaves `main()` holding only I/O setup and reporting,
 * and puts every decision about *which* enumerator gets *which* argument under
 * test.
 *
 * `listKeys` is injected so the R2 branch is reachable without a live bucket.
 */
export async function enumerate({ localDir, owners, listKeys }) {
  if (localDir) return enumerateLocal(path.join(localDir, 'projects'), owners);
  return planFromKeys(await listKeys(), owners);
}

/**
 * What could not be placed, counted in the units it is actually reported in.
 *
 * `commingled` and `orphaned` are keyed by **slug**; `collisions` is a list of
 * individual **files**. `main()` summed all three into one number and printed
 * it as "N slug(s) could not be placed automatically", which is three counts of
 * two different things added together and labelled as one of them. The exit
 * code was right; the number an operator reads was not.
 *
 * `blocked` is what drives the non-zero exit, and it must stay a disjunction
 * over all three: a run whose only problem is an occupied destination has no
 * commingled or orphaned slugs at all, and dropping `collisions` from the tally
 * exits 0 on exactly the case where `--apply` would have overwritten live bytes
 * with pre-fix ones and deleted the evidence.
 */
export function unresolvedCounts({ commingled, orphaned, collisions }) {
  const slugs = commingled.size + orphaned.size;
  const files =
    [...commingled.values()].reduce((n, v) => n + v.files.length, 0) +
    [...orphaned.values()].reduce((n, v) => n + v.length, 0) +
    collisions.length;
  return { slugs, occupied: collisions.length, files, blocked: slugs + collisions.length > 0 };
}

/** slug -> [userId, ...], from the only authority on ownership. */
async function ownersBySlug(sql) {
  const rows = await sql`SELECT slug, user_id FROM projects ORDER BY slug, user_id`;
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.slug)) map.set(r.slug, []);
    map.get(r.slug).push(r.user_id);
  }
  return map;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!databaseUrl) {
    console.error('Error: DATABASE_URL is not set — it is the only source of slug ownership.');
    process.exit(1);
  }
  const isSupabase =
    databaseUrl.includes('supabase.co') || databaseUrl.includes('pooler.supabase.com');

  const sql = postgres(databaseUrl, {
    max: 1,
    ssl: isSupabase ? 'require' : false,
    prepare: false,
  });
  let s3 = null;
  let bucket = null;

  try {
    const owners = await ownersBySlug(sql);

    // Build the R2 client up front if that is the backend, so `enumerate` gets
    // a ready `listKeys` and holds no credential handling of its own.
    if (!LOCAL_DIR) {
      bucket = process.env.R2_BUCKET;
      if (!bucket || !process.env.R2_ENDPOINT) {
        console.error('Error: R2_BUCKET and R2_ENDPOINT are required without --local.');
        process.exit(1);
      }
      s3 = new S3Client({
        region: 'auto',
        endpoint: process.env.R2_ENDPOINT,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true,
      });
    }

    // Both enumerators take the same argument — the slug map — and derive the
    // userId set themselves via `ownerIdsOf`, so there is no second set here
    // for a caller to mix up. That mix-up was both round-2 defects.
    const { legacy, legacyIndexes, existingKeys } = await enumerate({
      localDir: LOCAL_DIR,
      owners,
      listKeys: () => listAllKeys(s3, bucket),
    });

    // Bucket the legacy slugs by how confidently we can place them.
    const { movable, commingled, orphaned } = bucketByOwnership(legacy, owners);
    // ...then withhold any whose destination is already occupied.
    const { moves, collisions } = splitCollisions(movable, existingKeys);

    console.log(`Mode:            ${APPLY ? 'APPLY' : 'DRY RUN (pass --apply to execute)'}`);
    console.log(`Backend:         ${LOCAL_DIR ? `local fs (${LOCAL_DIR})` : `R2 (${bucket})`}`);
    console.log(`Legacy files:    ${legacy.length}`);
    console.log(`  unambiguous:   ${moves.length}`);
    console.log(
      `  commingled:    ${[...commingled.values()].reduce((n, v) => n + v.files.length, 0)}`
    );
    console.log(`  orphaned:      ${[...orphaned.values()].reduce((n, v) => n + v.length, 0)}`);
    console.log(`  dest occupied: ${collisions.length}`);
    console.log(`Legacy indexes:  ${legacyIndexes.length} (regenerable; deleted, not moved)`);

    for (const [slug, { owners: o, files }] of commingled) {
      console.log(`\n!! COMMINGLED slug "${slug}" — ${o.length} owners: ${o.join(', ')}`);
      console.log(`   ${files.length} file(s) left in place, needs a human call on attribution:`);
      for (const f of files) console.log(`     projects/${slug}/${f}`);
    }
    for (const [slug, files] of orphaned) {
      console.log(
        `\n!! ORPHANED slug "${slug}" — no projects row owns it; ${files.length} file(s) left in place.`
      );
    }
    for (const c of collisions) {
      console.log(`\n!! DESTINATION OCCUPIED — ${c.dest} already exists.`);
      console.log(
        `   projects/${c.slug}/${c.fileName} left in place. The owner has written since the fix`
      );
      console.log(`   shipped, so migrating would replace current bytes with pre-fix ones.`);
    }

    if (APPLY) {
      for (const m of moves) {
        if (LOCAL_DIR) {
          const dest = path.join(LOCAL_DIR, m.dest);
          await fs.mkdir(path.dirname(dest), { recursive: true });
          // `rename` clobbers silently and `moves` was computed from an earlier
          // walk, so re-check rather than trust the plan: this is the step that
          // destroys the source.
          if (await fs.stat(dest).catch(() => null)) {
            throw new Error(`Refusing to overwrite ${m.dest} — it appeared after the scan.`);
          }
          await fs.rename(m.key, dest);
        } else {
          // The key may contain spaces or `#` — `validateFileName` only rejects
          // path traversal — and CopySource is a URL path, so an unencoded one
          // fails the copy and aborts the run.
          const source = `${bucket}/${m.key}`.split('/').map(encodeURIComponent).join('/');
          await s3.send(new CopyObjectCommand({ Bucket: bucket, CopySource: source, Key: m.dest }));
          // Confirm the copy landed *before* destroying the only other replica.
          await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: m.dest }));
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: m.key }));
        }
      }
      for (const key of legacyIndexes) {
        // The index is a derived artefact — `POST /api/projects/generate-index`
        // rebuilds it per-owner. Moving it would just relocate stale content
        // that names other users' files.
        if (LOCAL_DIR) await fs.rm(key, { force: true });
        else await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      }
      // Prune the now-empty legacy slug directories on the local backend.
      if (LOCAL_DIR) {
        for (const slug of new Set(moves.map((m) => m.slug))) {
          await fs.rmdir(path.join(LOCAL_DIR, 'projects', slug)).catch(() => null);
        }
      }
      console.log(
        `\nMoved ${moves.length} file(s); removed ${legacyIndexes.length} legacy index(es).`
      );
    } else if (moves.length) {
      console.log('\nWould move:');
      for (const m of moves.slice(0, 20)) {
        console.log(
          `  projects/${m.slug}/${m.fileName}  ->  projects/${m.userId}/${m.slug}/${m.fileName}`
        );
      }
      if (moves.length > 20) console.log(`  ... and ${moves.length - 20} more`);
    }

    const unresolved = unresolvedCounts({ commingled, orphaned, collisions });
    if (unresolved.blocked) {
      console.error(
        `\n${unresolved.files} file(s) could not be placed automatically — ` +
          `${unresolved.slugs} unattributable slug(s) and ` +
          `${unresolved.occupied} occupied destination(s). See above.`
      );
      process.exit(2);
    }
    console.log('\nAll legacy project artefacts are attributable.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// Only run when invoked as a CLI, so the pure helpers above can be imported by
// tests without the script connecting to a database on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
