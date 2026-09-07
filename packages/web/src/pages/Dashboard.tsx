import { Link } from 'react-router-dom';
import { DashboardStats } from '../components/DashboardStats';
import { DashboardResumeWidget } from '../components/DashboardResumeWidget';
import { AttentionCard } from '../components/AttentionCard';
import { QuickWins } from '../components/QuickWins';
import { useDashboard } from '../hooks/useDashboard';
import { useResumes } from '../hooks/useResumes';
import { APPLIED_WINDOW_METRIC_LABEL } from '../constants/appliedWindow';

export function Dashboard() {
  // ⚠️ `isPending`, NOT `isLoading` (WIC-2227). `isLoading` is `isPending && isFetching`,
  // so it is false for a pending-but-*paused* query — what the default
  // `networkMode: "online"` does the moment the browser reports itself offline — and
  // `data` is still undefined there. Reading it let the resume widget below fall through
  // to "No resumes yet" / "Upload Your First Resume" for a user who has resumes.
  const {
    data: dashboardData,
    isPending: dashboardPending,
    isError: dashboardError,
  } = useDashboard();
  // ⚠️ No `= []` default (WIC-2236), for the same reason `stats` below has no zeros object.
  // The default collapsed "no measurement" into a measured `0` before the resume widget
  // ever saw it, so the widget could not tell a user with genuinely no resumes from one
  // whose list we failed to read — and it therefore had to treat `error` alone as proof
  // that its counts were worthless. `undefined` is what makes the difference expressible.
  const { data: resumes, isPending: resumesPending, isError: resumesError } = useResumes();

  const loading = dashboardPending || resumesPending;

  // ⚠️ No `|| { total: 0, byStatus: {}, … }` fallback here (WIC-2229). PR #458 moved this
  // page off `isLoading`, but left the zeros object in place — so a FAILED `GET /dashboard`
  // still rendered "0 / 0 / 0% / 0" and "In Progress 0" as measured facts about the user's
  // pipeline. `byStatus` defaulting to `{}` made it worse than a plain zero: the arithmetic
  // below produced `undefined + undefined` = `NaN`, which `|| 0` laundered into a confident
  // `0`. The three unsettled states (pending, paused, failed) all leave `stats` undefined,
  // and none of them entitles this page to state a number — so the number is now
  // unrepresentable without one, rather than defaulted.
  const stats = dashboardData?.stats;

  const displayStats = stats
    ? {
        total: stats.total,
        appliedThisWeek: stats.appliedThisWeek,
        responseRate: stats.responseRate,
        inReview: stats.byStatus.phone_screen + stats.byStatus.interview || 0,
      }
    : undefined;

  const inProgressCount = stats
    ? (stats.byStatus.phone_screen || 0) + (stats.byStatus.interview || 0)
    : undefined;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-neutral-900">Dashboard</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Track your job applications and manage your resumes
        </p>
      </div>

      <div className="mb-6">
        <DashboardStats stats={displayStats} loading={loading} error={dashboardError} />
      </div>

      <div className="mb-6">
        {/*
          `error` is read here but `attention` is not gated on it (WIC-2236): a failed
          refetch keeps the cached aggregates, so the flag only decides what this card
          says when it has nothing — "couldn't load" rather than a "checking" claim that
          outlives the request it describes.
        */}
        <QuickWins attention={dashboardData?.attention} error={dashboardError} />
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <AttentionCard attention={dashboardData?.attention} />

        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">📋</span>
              <h2 className="text-lg font-semibold text-neutral-900">Quick Actions</h2>
            </div>
          </div>
          <div className="space-y-2">
            <Link
              to="/applications/new"
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              <span>➕</span>
              <span>Add Application</span>
            </Link>
            <Link
              to="/job-fit-analysis"
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              <span>🔍</span>
              <span>Analyze Job Fit</span>
            </Link>
            <Link
              to="/resumes/upload"
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              <span>📄</span>
              <span>Upload Resume</span>
            </Link>
            <Link
              to="/applications"
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              <span>📊</span>
              <span>View All Applications</span>
            </Link>
          </div>
        </div>

        <DashboardResumeWidget
          // `resumes?.length`, not `resumes.length` — see the hook read above. Both props
          // are fed from the one array, so they are measured together or not at all.
          masterResumeCount={resumes?.length}
          exportCount={resumes?.length}
          loading={loading}
          // A failed resumes request must not read as "you have none": `isError` leaves
          // `data` undefined permanently, so the empty branch would be a standing false
          // claim rather than a flash (WIC-2227). It is now passed alongside the counts
          // rather than instead of them, so a failed *refetch* over a warm cache keeps
          // the figures and discloses that they are stale (WIC-2236).
          error={resumesError}
        />

        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">📈</span>
              <h2 className="text-lg font-semibold text-neutral-900">Recent Activity</h2>
            </div>
          </div>
          <div className="space-y-3">
            {/*
              Same rule as the stat cards above, and this panel needed it more: it had no
              loading gate at all, so it stated "In Progress 0" during the request as well
              as after a failed one. Both figures come off `stats`, so both are withheld
              together — a partially-populated activity list would be its own false claim
              (WIC-2229).

              ⚠️ Gated on `stats`, deliberately NOT on `dashboardError` (WIC-2233). A failed
              *refetch* keeps the previous data, so `dashboardError` is true while `stats`
              is still a real measurement. Adding it here would blank this panel while
              `QuickWins` and `AttentionCard` — same query object, same cached `attention` —
              carried on rendering, which is the contradiction WIC-2233 was filed for, just
              moved. `DashboardStats` discloses the stale refresh once, next to the figures.
            */}
            {stats ? (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-600">In Progress</span>
                  <span className="font-semibold text-neutral-900">{inProgressCount}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  {/* Rolling window, not the current calendar week — see constants/appliedWindow.ts. */}
                  <span className="text-neutral-600">{APPLIED_WINDOW_METRIC_LABEL}</span>
                  <span className="font-semibold text-neutral-900">{stats.appliedThisWeek}</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-neutral-500">
                {/*
                  Not "Checking your applications…" — that is `QuickWins`'s unsettled copy
                  and it renders from the same query, so the two panels would show the same
                  sentence twice on the same screen. (It also made an early draft of the
                  test ambiguous, which is how it was noticed.)
                */}
                {dashboardError
                  ? 'Couldn’t load your recent activity. Please try again.'
                  : 'Checking your recent activity…'}
              </p>
            )}
            <Link
              to="/applications"
              className="mt-4 block rounded-lg border border-primary-600 px-4 py-2 text-center text-sm font-medium text-primary-600 hover:bg-primary-50"
            >
              View All Applications
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
