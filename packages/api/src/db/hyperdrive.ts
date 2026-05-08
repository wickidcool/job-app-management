// Hyperdrive inter-node timeout is transient and safe to retry because it
// fires before any SQL executes (during connection pool coordination).
export const HYPERDRIVE_TIMEOUT_MSG =
  'Timed out while waiting for a message from another Hyperdrive node';

export function isHyperdriveTimeout(err: unknown): boolean {
  return err instanceof Error && err.message.includes(HYPERDRIVE_TIMEOUT_MSG);
}
