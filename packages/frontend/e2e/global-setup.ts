import { rmSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export default function globalSetup() {
  // Clear E2E data directory content before each run to prevent slug collisions
  // across runs. Recreate the directory structure so a reused server still works.
  const e2eDataDir = '/tmp/e2e-data';
  const projectsDir = join(e2eDataDir, 'projects');

  // Remove and recreate top-level dir
  rmSync(e2eDataDir, { recursive: true, force: true });
  mkdirSync(projectsDir, { recursive: true });
}
