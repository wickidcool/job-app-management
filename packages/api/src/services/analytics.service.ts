// Analytics instrumentation wrapper (WIC-814).
//
// A thin, provider-agnostic wrapper so instrumentation callsites never depend on
// the underlying analytics vendor. Swap the sink via the `ANALYTICS_SINK` env var
// without touching a single `track()` callsite.
//
// Event names and property schemas are defined by the board-approved Metrics
// Baseline doc: docs/analytics/metrics-baseline.md (section 3, Event Taxonomy).
//
// Chosen sink: PostHog (see section 5/6 of the baseline and the WIC-814 comment
// thread). PostHog's HTTP capture API works from Cloudflare Workers over `fetch`,
// and its product-analytics feature set (funnels, retention, trends) maps directly
// onto the KPIs in the baseline. Selection is env-driven and defaults to a no-op
// so nothing emits until prod is deliberately wired.

import { getConfig } from '../config.js';

/**
 * The full analytics event taxonomy (baseline section 3). All 9 events are typed
 * here so both the server-side emitters (this package) and any future shared
 * consumers reference one canonical list of names. The server owns the three
 * `submitted / completed / failed` events; the client owns the remaining six.
 */
export type AnalyticsEventName =
  | 'resume_upload_started'
  | 'resume_upload_validation_failed'
  | 'resume_upload_submitted'
  | 'resume_upload_completed'
  | 'resume_upload_failed'
  | 'resume_upload_cta_clicked'
  | 'resume_manager_viewed'
  | 'resume_exports_link_clicked'
  | 'export_viewed';

/** Property shapes for the server-owned events (baseline section 3.1). */
export interface ResumeUploadSubmittedProps {
  session_id: string | null;
  file_type: 'pdf' | 'docx';
  file_size_bytes: number;
}

export interface ResumeUploadCompletedProps {
  session_id: string | null;
  resume_id: string;
  export_id: string;
  file_type: 'pdf' | 'docx';
  file_size_bytes: number;
  processing_time_ms: number;
  sections_detected: number;
  bullets_total: number;
  extracted_char_count: number;
  /**
   * True when the upload short-circuited on duplicate content (content-hash match)
   * rather than running the full extract→parse→export pipeline. Timing KPIs (Avg /
   * P95 Processing Time, baseline §2.1) filter `is_duplicate = false`; funnel /
   * completion KPIs keep all rows. See WIC-817.
   */
  is_duplicate: boolean;
}

export interface ResumeUploadFailedProps {
  session_id: string | null;
  file_type: 'pdf' | 'docx' | 'unknown';
  error_code: string;
  error_stage: 'upload' | 'extraction' | 'parsing' | 'export_generation';
}

export interface AnalyticsEvent {
  event: AnalyticsEventName;
  /** ISO-8601 timestamp of when the event occurred. */
  timestamp: string;
  /** Per-browser-session identifier propagated from the client (may be null). */
  sessionId: string | null;
  properties: Record<string, unknown>;
}

/** Pluggable delivery target. Implementations MUST NOT throw. */
export interface AnalyticsSink {
  readonly name: string;
  capture(event: AnalyticsEvent): Promise<void> | void;
}

/** Discards events. Default sink — nothing emits until a provider is configured. */
const noopSink: AnalyticsSink = {
  name: 'noop',
  capture() {
    /* intentionally empty */
  },
};

/** Logs events to stdout. Useful in local dev to verify instrumentation fires. */
const consoleSink: AnalyticsSink = {
  name: 'console',
  capture(event) {
    console.log(
      `[analytics] ${event.event} session=${event.sessionId ?? 'none'} ${JSON.stringify(
        event.properties
      )}`
    );
  },
};

/**
 * Sends events to PostHog's `/capture` HTTP endpoint. `session_id` is mapped to
 * PostHog's `distinct_id` so per-session funnels/retention work out of the box;
 * the raw `session_id` is also kept as a property. Failures are swallowed —
 * analytics must never break the request path.
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
          body: JSON.stringify({
            api_key: apiKey,
            event: event.event,
            timestamp: event.timestamp,
            distinct_id: event.sessionId ?? 'anonymous',
            properties: {
              ...event.properties,
              session_id: event.sessionId,
              $lib: 'wic-api',
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
  };
}

let _sink: AnalyticsSink | null = null;

/** Resets the memoized sink. Test-only. */
export function _resetAnalyticsSink(): void {
  _sink = null;
}

function resolveSink(): AnalyticsSink {
  if (_sink) return _sink;
  const config = getConfig();

  switch (config.analyticsSink) {
    case 'posthog':
      if (config.posthogApiKey) {
        _sink = createPostHogSink(config.posthogApiKey, config.posthogHost);
      } else {
        console.warn(
          '[analytics] ANALYTICS_SINK=posthog but POSTHOG_API_KEY is unset — using noop'
        );
        _sink = noopSink;
      }
      break;
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
 * Emit an analytics event. Never throws and never rejects — a failed capture is
 * logged and swallowed so instrumentation can never break the request it observes.
 */
export async function track(
  event: AnalyticsEventName,
  properties: Record<string, unknown>,
  sessionId?: string | null
): Promise<void> {
  try {
    const sink = resolveSink();
    await sink.capture({
      event,
      timestamp: new Date().toISOString(),
      sessionId: sessionId ?? null,
      properties,
    });
  } catch (err) {
    console.error('[analytics] track failed:', err instanceof Error ? err.message : err);
  }
}
