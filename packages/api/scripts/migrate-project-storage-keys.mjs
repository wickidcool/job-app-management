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
// Idempotent: a second run finds no legacy keys and exits 0.
import postgres from 'postgres';
import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const APPLY = process.argv.includes('--apply');
const localIdx = process.argv.indexOf('--local');
const LOCAL_DIR = localIdx === -1 ? null : process.argv[localIdx + 1];

/**
 * Legacy vs already-migrated, decided purely on key segment count.
 *
 *   projects/index.md                    2 -> legacy index (derived, delete)
 *   projects/{slug}/{file}               3 -> legacy
 *   projects/{userId}/{slug}/{file}      4 -> already namespaced
 *
 * The count is exact rather than a heuristic **only because a project file name
 * can never contain `/`** — `project.service.validateFileName` rejects `..`,
 * `/` and `\`, so a legacy slug directory is always exactly one level deep and
 * no key can be ambiguous between the two shapes. If that guard ever loosens,
 * this discriminator breaks and the migration would mis-file. Exported so
 * `test/migrate-project-storage-keys.test.ts` pins it.
 */
export function classify(key) {
  const parts = key.split('/');
  if (parts[0] !== 'projects') return { kind: 'foreign' };
  if (parts.length === 2) return { kind: 'legacy-index' }; // projects/index.md
  if (parts.length === 3) return { kind: 'legacy', slug: parts[1], fileName: parts[2] };
  return { kind: 'namespaced' };
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

    // Enumerate legacy entries from whichever backend we were pointed at.
    let legacy = []; // { key, slug, fileName }
    let legacyIndexes = [];
    if (LOCAL_DIR) {
      const root = path.join(LOCAL_DIR, 'projects');
      const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        // A directory named for a user_id is an already-migrated tree, not a slug.
        if (e.isDirectory() && owners.has(e.name)) continue;
        if (e.isFile() && e.name === 'index.md') {
          legacyIndexes.push(path.join(root, e.name));
          continue;
        }
        if (!e.isDirectory()) continue;
        // Anything that is not a known owner id is treated as a legacy slug dir.
        const files = await fs.readdir(path.join(root, e.name)).catch(() => []);
        for (const f of files) {
          legacy.push({ key: path.join(root, e.name, f), slug: e.name, fileName: f });
        }
      }
    } else {
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
      for (const key of await listAllKeys(s3, bucket)) {
        const c = classify(key);
        if (c.kind === 'legacy') legacy.push({ key, slug: c.slug, fileName: c.fileName });
        else if (c.kind === 'legacy-index') legacyIndexes.push(key);
      }
    }

    // Bucket the legacy slugs by how confidently we can place them.
    const { movable, commingled, orphaned } = bucketByOwnership(legacy, owners);

    console.log(`Mode:            ${APPLY ? 'APPLY' : 'DRY RUN (pass --apply to execute)'}`);
    console.log(`Backend:         ${LOCAL_DIR ? `local fs (${LOCAL_DIR})` : `R2 (${bucket})`}`);
    console.log(`Legacy files:    ${legacy.length}`);
    console.log(`  unambiguous:   ${movable.length}`);
    console.log(
      `  commingled:    ${[...commingled.values()].reduce((n, v) => n + v.files.length, 0)}`
    );
    console.log(`  orphaned:      ${[...orphaned.values()].reduce((n, v) => n + v.length, 0)}`);
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

    if (APPLY) {
      for (const m of movable) {
        if (LOCAL_DIR) {
          const dest = path.join(LOCAL_DIR, 'projects', m.userId, m.slug, m.fileName);
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.rename(m.key, dest);
        } else {
          const dest = `projects/${m.userId}/${m.slug}/${m.fileName}`;
          await s3.send(
            new CopyObjectCommand({
              Bucket: bucket,
              CopySource: `${bucket}/${m.key}`,
              Key: dest,
            })
          );
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
        for (const slug of new Set(movable.map((m) => m.slug))) {
          await fs.rmdir(path.join(LOCAL_DIR, 'projects', slug)).catch(() => null);
        }
      }
      console.log(
        `\nMoved ${movable.length} file(s); removed ${legacyIndexes.length} legacy index(es).`
      );
    } else if (movable.length) {
      console.log('\nWould move:');
      for (const m of movable.slice(0, 20)) {
        console.log(
          `  projects/${m.slug}/${m.fileName}  ->  projects/${m.userId}/${m.slug}/${m.fileName}`
        );
      }
      if (movable.length > 20) console.log(`  ... and ${movable.length - 20} more`);
    }

    const unresolved = commingled.size + orphaned.size;
    if (unresolved > 0) {
      console.error(`\n${unresolved} slug(s) could not be placed automatically. See above.`);
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
