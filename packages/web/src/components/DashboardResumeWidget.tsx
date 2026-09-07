import { Link } from 'react-router-dom';

interface DashboardResumeWidgetProps {
  /**
   * `undefined` means "not measured", and it has no default (WIC-2236).
   *
   * The caller's query leaves `data` undefined in pending, offline-paused and failed
   * alike, and the old `= 0` default rounded all three to a measured zero before any
   * guard here could see them. That collapse is what forced `error` to be treated as
   * proof the counts were worthless — with no way to distinguish a cold failure from a
   * user who genuinely has none, withholding was the only safe move. Accepting
   * `undefined` is what makes "no measurement" expressible instead of rounded.
   */
  masterResumeCount?: number;
  exportCount?: number;
  loading?: boolean;
  /**
   * The resumes request failed.
   *
   * Distinct from `loading` rather than folded into it (WIC-2227): a failed query never
   * settles into data, so rendering the skeleton would leave a loading animation on
   * screen forever.
   *
   * ⚠️ It does **not** on its own mean there is no count to show — see the guard below.
   * Same rule as `DashboardStats.error`, which this component's doc comment cites and
   * which this one used to contradict (WIC-2236).
   */
  error?: boolean;
}

export function DashboardResumeWidget({
  masterResumeCount,
  exportCount,
  loading = false,
  error = false,
}: DashboardResumeWidgetProps) {
  // Both counts come off one `resumes` array in the caller, so they arrive together or
  // not at all; requiring both keeps a half-populated render unreachable rather than
  // merely unrendered.
  const measured = masterResumeCount !== undefined && exportCount !== undefined;

  // Ahead of both branches below: an unread count must not become a claim about the
  // user's resumes, in either the "still checking" or the "you have none" direction.
  //
  // ⚠️ `&& !measured` is the whole guard (WIC-2236). React Query's *refetch* error keeps
  // the previous data (`QueryObserverRefetchErrorResult`), so `error` is true while the
  // counts are still a real measurement — reachable by ordinary navigation, since
  // `useResumes` carries `staleTime: 30000` with `refetchOnMount` left at its default.
  // Gating on `error` alone made this widget withhold a figure it was holding, which is
  // exactly the defect WIC-2233 had just corrected in `DashboardStats` next door. The
  // stale-refresh note below is what keeps keeping the figure honest rather than silent.
  if (error && !measured) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📄</span>
            <h2 className="text-lg font-semibold text-neutral-900">Your Resumes</h2>
          </div>
          <Link
            to="/resumes"
            className="text-sm text-primary-600 hover:text-primary-700"
            aria-label="Go to Resume Manager"
          >
            →
          </Link>
        </div>
        <p className="text-sm text-neutral-600">
          Couldn&rsquo;t load your resumes. Please try again.
        </p>
      </div>
    );
  }

  // `!measured` is not redundant with `loading`: it is what keeps the counts below
  // unreachable without a measurement, so a caller that forgets to pass `loading` still
  // cannot make this widget state a figure it was never given.
  if (loading || !measured) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📄</span>
            <h2 className="text-lg font-semibold text-neutral-900">Your Resumes</h2>
          </div>
          <span className="text-neutral-400">→</span>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-32 rounded bg-neutral-200" />
          <div className="h-4 w-24 rounded bg-neutral-200" />
        </div>
      </div>
    );
  }

  // Past both guards there is a measurement, so this is a statement about the user's
  // resumes rather than about the request.
  const hasResumes = masterResumeCount > 0 || exportCount > 0;

  if (!hasResumes) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📄</span>
            <h2 className="text-lg font-semibold text-neutral-900">Your Resumes</h2>
          </div>
          <Link
            to="/resumes"
            className="text-sm text-primary-600 hover:text-primary-700"
            aria-label="Go to Resume Manager"
          >
            →
          </Link>
        </div>

        <div className="mb-4 text-center">
          <div className="mb-2 text-4xl">📋</div>
          <p className="text-sm text-neutral-600">No resumes yet</p>
          <p className="mt-1 text-xs text-neutral-500">
            Upload your resume to create tailored versions for each job
          </p>
        </div>

        <Link
          to="/resumes/upload"
          className="block w-full rounded-lg bg-primary-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-primary-700"
        >
          Upload Your First Resume
        </Link>
        <StaleRefreshNote show={error} />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">📄</span>
          <h2 className="text-lg font-semibold text-neutral-900">Your Resumes</h2>
        </div>
        <Link
          to="/resumes"
          className="text-sm text-primary-600 hover:text-primary-700"
          aria-label="Go to Resume Manager"
        >
          →
        </Link>
      </div>

      <div className="mb-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-neutral-600">Master resumes:</span>
          <span className="font-semibold text-neutral-900">{masterResumeCount}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-neutral-600">Exports:</span>
          <span className="font-semibold text-neutral-900">{exportCount}</span>
        </div>
      </div>

      <Link
        to="/resumes/upload"
        className="block w-full rounded-lg border border-primary-600 px-4 py-2 text-center text-sm font-medium text-primary-600 hover:bg-primary-50"
      >
        Upload New Resume
      </Link>
      <StaleRefreshNote show={error} />
    </div>
  );
}

/**
 * Only reachable with `error && measured` — a refresh that failed over counts we already
 * have. Rendered in both branches past the guards, because a cached empty list is as much
 * a real-but-dated measurement as a cached non-empty one, and "No resumes yet" is the
 * stronger claim of the two.
 *
 * The wording deliberately shares no phrase with `DashboardStats`'s equivalent note
 * ("last successful load"). Both can be on screen at once — two queries, two independent
 * refetches — and a page-level `findByText` matching both throws on the duplicate rather
 * than failing an assertion, which is a confusing way to learn about a copy collision.
 */
function StaleRefreshNote({ show }: { show: boolean }) {
  if (!show) return null;

  return (
    <p role="status" className="mt-2 text-sm text-neutral-500">
      Showing your most recent successful load — the latest refresh didn&rsquo;t go through.
    </p>
  );
}
