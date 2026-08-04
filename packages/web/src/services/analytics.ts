// Client-side analytics instrumentation wrapper (WIC-814 client half).
//
// A thin, provider-agnostic wrapper so instrumentation callsites never depend on
// the underlying analytics vendor. It mirrors the server-side wrapper
// (`packages/api/src/services/analytics.service.ts`) so the client and server
// emit into the same PostHog project with correlated `session_id`s.
//
// Event names and property schemas are defined by the board-approved Metrics
// Baseline doc: docs/analytics/metrics-baseline.md (section 3, Event Taxonomy).
// The server owns the three `submitted / completed / failed` events; this module
// owns the remaining six client events.
//
// Sink selection is env-driven (Vite `import.meta.env`) and defaults to a no-op
// so nothing emits until prod is deliberately wired:
//   VITE_ANALYTICS_SINK   'noop' (default) | 'console' | 'posthog'
//   VITE_POSTHOG_KEY      PostHog project API key (required for the posthog sink)
//   VITE_POSTHOG_HOST     PostHog host (default https://us.i.posthog.com)
//
// PostHog is reached via its `/capture` HTTP endpoint over `fetch` — the same
// approach as the server wrapper — so no browser SDK dependency is required and
// the provider stays swappable behind this module.

/**
 * The six client-owned analytics events (baseline section 3). Named here so every
 * callsite references one canonical list. The three server-owned events
 * (`resume_upload_submitted / completed / failed`) live in the API package.
 */
export type ClientAnalyticsEventName =
  | 'resume_upload_started'
  | 'resume_upload_validation_failed'
  | 'resume_upload_cta_clicked'
  | 'resume_manager_viewed'
  | 'resume_exports_link_clicked'
  | 'export_viewed';

/**
 * Per-event property shapes (baseline section 3). `session_id` is intentionally
 * NOT part of these payloads — it is injected automatically by `track()` from the
 * per-browser-session id, so callsites can never forget it or send a wrong value.
 */
export interface ClientAnalyticsEventProps {
  resume_upload_started: {
    source: 'file_picker' | 'drag_drop';
  };
  resume_upload_validation_failed: {
    error_type: 'invalid_type' | 'size_exceeded';
    file_mime_type: string;
    file_size_bytes: number;
  };
  resume_upload_cta_clicked: {
    resume_id: string;
    cta: 'view_details' | 'upload_new';
  };
  resume_manager_viewed: {
    resume_count: number;
  };
  resume_exports_link_clicked: {
    resume_id: string;
    resume_file_type: 'pdf' | 'docx';
  };
  export_viewed: {
    resume_id: string;
    export_id: string;
    export_type: 'star_markdown';
  };
}

interface AnalyticsEvent {
  event: ClientAnalyticsEventName;
  /** ISO-8601 timestamp of when the event occurred. */
  timestamp: string;
  /** Per-browser-session identifier. Always sent as the `session_id` property. */
  sessionId: string;
  /**
   * Identity the event is attributed to: the authenticated `userId` once
   * `identify()` has run, otherwise the anonymous `sessionId`. Maps to PostHog's
   * `distinct_id`, so post-login events stitch to the real user while pre-login
   * events stay session-scoped (and later alias onto the user via `identify()`).
   */
  distinctId: string;
  properties: Record<string, unknown>;
}

/** Pluggable delivery target. Implementations MUST NOT throw. */
interface AnalyticsSink {
  readonly name: string;
  capture(event: AnalyticsEvent): Promise<void> | void;
  /**
   * Alias the anonymous session (`anonId`) onto an authenticated `userId` so the
   * user's pre-login events merge into their identified profile. Optional — sinks
   * without an identity model (noop/console) may omit it.
   */
  identify?(userId: string, anonId: string): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Session id — one id per browser session, persisted in sessionStorage so it
// survives client-side navigation but resets on a new tab/session. Sent both as
// the `session_id` property on every client event AND as the `X-Session-Id`
// header on resume uploads so client + server events correlate into one funnel.
// ---------------------------------------------------------------------------

const SESSION_STORAGE_KEY = 'wic_analytics_session_id';

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to Math.random fallback */
  }
  return `sess_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Returns the current browser session id, creating and persisting one on first
 * call. Safe to call in non-browser contexts (SSR/tests) — falls back to an
 * ephemeral id when `sessionStorage` is unavailable.
 */
export function getSessionId(): string {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      let id = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!id) {
        id = randomId();
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, id);
      }
      return id;
    }
  } catch {
    /* sessionStorage can throw in private-mode / sandboxed contexts */
  }
  return randomId();
}

/**
 * Replaces the persisted session id with a fresh one. Called on `reset()` (logout)
 * so a subsequent, different user on a shared browser starts from a new anonymous
 * identity and their pre-login events can't alias onto the previous user.
 */
function rotateSessionId(): void {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, randomId());
    }
  } catch {
    /* sessionStorage can throw in private-mode / sandboxed contexts */
  }
}

// ---------------------------------------------------------------------------
// Sinks
// ---------------------------------------------------------------------------

/** Discards events. Default sink — nothing emits until a provider is configured. */
const noopSink: AnalyticsSink = {
  name: 'noop',
  capture() {
    /* intentionally empty */
  },
};

/** Logs events to the console. Useful in local dev to verify instrumentation fires. */
const consoleSink: AnalyticsSink = {
  name: 'console',
  capture(event) {
    console.log(
      `[analytics] ${event.event} session=${event.sessionId} ${JSON.stringify(event.properties)}`
    );
  },
};

/**
 * Sends events to PostHog's `/capture` HTTP endpoint. `distinct_id` is the
 * event's resolved identity — the authenticated `userId` once `identify()` has
 * run, otherwise the anonymous `session_id`, which is also always kept as a
 * property for session-level analysis. `identify()` emits a `$identify` event
 * that aliases the anonymous session onto the user so pre- and post-login events
 * stitch into one person. Uses `keepalive` so events fired during navigation
 * still flush. Failures are swallowed — analytics must never break the app.
 */
function createPostHogSink(apiKey: string, host: string): AnalyticsSink {
  const endpoint = `${host.replace(/\/$/, '')}/capture/`;
  return {
    name: 'posthog',
    async capture(event) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
          body: JSON.stringify({
            api_key: apiKey,
            event: event.event,
            timestamp: event.timestamp,
            distinct_id: event.distinctId,
            properties: {
              ...event.properties,
              session_id: event.sessionId,
              $lib: 'wic-web',
            },
          }),
        });
        if (!res.ok) {
          console.error(`[analytics] posthog capture failed: HTTP ${res.status}`);
        }
      } catch (err) {
        console.error(
          '[analytics] posthog capture error:',
          err instanceof Error ? err.message : err
        );
      }
    },
    async identify(userId, anonId) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
          body: JSON.stringify({
            api_key: apiKey,
            event: '$identify',
            timestamp: new Date().toISOString(),
            distinct_id: userId,
            // `$anon_distinct_id` is PostHog's alias key: it merges the prior
            // anonymous person (`anonId`) into the identified user.
            properties: {
              $anon_distinct_id: anonId,
              session_id: anonId,
              $lib: 'wic-web',
            },
          }),
        });
        if (!res.ok) {
          console.error(`[analytics] posthog identify failed: HTTP ${res.status}`);
        }
      } catch (err) {
        console.error(
          '[analytics] posthog identify error:',
          err instanceof Error ? err.message : err
        );
      }
    },
  };
}

let _sink: AnalyticsSink | null = null;

// ---------------------------------------------------------------------------
// Identity — once a user authenticates, `identify()` records their `userId` so
// subsequent events are attributed to the user (`distinct_id = userId`) rather
// than the anonymous session, and a one-time `$identify` alias stitches the
// pre-login session events onto that user. `reset()` (logout) clears it.
// ---------------------------------------------------------------------------

let _identifiedUserId: string | null = null;

/** Resolves the `distinct_id` for an event: the user id if identified, else the session id. */
function resolveDistinctId(sessionId: string): string {
  return _identifiedUserId ?? sessionId;
}

/** Resets the memoized sink and identity. Test-only. */
export function _resetAnalyticsSink(): void {
  _sink = null;
  _identifiedUserId = null;
}

function envValue(key: string): string | undefined {
  // `import.meta.env` is Vite's compile-time env. Guarded so this module is also
  // importable in non-Vite contexts (e.g. unit tests) without throwing.
  try {
    const env = (import.meta as ImportMeta).env as Record<string, string | undefined> | undefined;
    return env?.[key];
  } catch {
    return undefined;
  }
}

function resolveSink(): AnalyticsSink {
  if (_sink) return _sink;

  const sinkName = (envValue('VITE_ANALYTICS_SINK') || 'noop').toLowerCase();

  switch (sinkName) {
    case 'posthog': {
      const apiKey = envValue('VITE_POSTHOG_KEY');
      const host = envValue('VITE_POSTHOG_HOST') || 'https://us.i.posthog.com';
      if (apiKey) {
        _sink = createPostHogSink(apiKey, host);
      } else {
        console.warn(
          '[analytics] VITE_ANALYTICS_SINK=posthog but VITE_POSTHOG_KEY is unset — using noop'
        );
        _sink = noopSink;
      }
      break;
    }
    case 'console':
      _sink = consoleSink;
      break;
    case 'noop':
    default:
      _sink = noopSink;
      break;
  }
  return _sink;
}

/**
 * Emit a client analytics event. `session_id` is injected automatically. Never
 * throws and never rejects — a failed capture is logged and swallowed so
 * instrumentation can never break the UI it observes.
 */
export function track<E extends ClientAnalyticsEventName>(
  event: E,
  properties: ClientAnalyticsEventProps[E]
): void {
  try {
    const sessionId = getSessionId();
    const sink = resolveSink();
    void sink.capture({
      event,
      timestamp: new Date().toISOString(),
      sessionId,
      distinctId: resolveDistinctId(sessionId),
      properties: { session_id: sessionId, ...properties },
    });
  } catch (err) {
    console.error('[analytics] track failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Associate the current browser with an authenticated user. Call on login and on
 * session-restore (token-backed app boot / refresh). Records `userId` so later
 * events attribute to the user, and emits a one-time `$identify` that aliases the
 * anonymous pre-login session onto them. Idempotent per user — re-identifying the
 * same `userId` (e.g. every restore) is a no-op. Never throws.
 */
export function identify(userId: string): void {
  try {
    if (!userId || userId === _identifiedUserId) return;
    const anonId = getSessionId();
    _identifiedUserId = userId;
    void resolveSink().identify?.(userId, anonId);
  } catch (err) {
    console.error('[analytics] identify failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Clear the identified user (call on logout). Subsequent events revert to the
 * anonymous session id, and the session id is rotated so a different user on a
 * shared browser can't have their pre-login events aliased onto the prior user.
 * Never throws.
 */
export function reset(): void {
  try {
    _identifiedUserId = null;
    rotateSessionId();
  } catch (err) {
    console.error('[analytics] reset failed:', err instanceof Error ? err.message : err);
  }
}
