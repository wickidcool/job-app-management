// Hyperdrive inter-node timeout is transient and safe to retry because it
// fires before any SQL executes (during connection pool coordination).
export const HYPERDRIVE_TIMEOUT_MSG =
  'Timed out while waiting for a message from another Hyperdrive node';

export function isHyperdriveTimeout(err: unknown): boolean {
  return err instanceof Error && err.message.includes(HYPERDRIVE_TIMEOUT_MSG);
}

// Workers spend one subrequest per outbound TCP connect and per fetch(), from a
// budget shared by the whole invocation. Once it is gone nothing else in that
// invocation can reach the network — not a retry, not the analytics capture that
// would have reported the failure. So this error is the opposite of the timeout
// above: never retryable, and the only correct response is to stop immediately.
export const SUBREQUEST_LIMIT_MSG = 'Too many subrequests';

export function isSubrequestExhaustion(err: unknown): boolean {
  return err instanceof Error && err.message.includes(SUBREQUEST_LIMIT_MSG);
}
