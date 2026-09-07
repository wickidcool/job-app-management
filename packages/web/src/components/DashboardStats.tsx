import { APPLIED_WINDOW_LABEL } from '../constants/appliedWindow';
import { toPercent, type Ratio } from '../types/units';

/** The four cards, in render order. Named so the skeleton can be sized without a `stats`. */
const STAT_LABELS = [
  'Total',
  // Rolling window, not the current calendar week — see constants/appliedWindow.ts.
  APPLIED_WINDOW_LABEL,
  'Response',
  'In Review',
];

export interface DashboardStatsProps {
  /**
   * Optional (WIC-2229). The caller's query leaves `data` undefined in all three unsettled
   * states — pending, offline-paused and failed — and a required prop pushed it into
   * inventing a zeros object to satisfy the type. Accepting `undefined` is what makes
   * "no measurement" expressible here instead of being rounded to `0`.
   */
  stats?: {
    total: number;
    appliedThisWeek: number;
    /**
     * Share of applications that drew a response, as a ratio in [0, 1].
     *
     * This is the unit the API ships (`GET /dashboard`, see
     * `docs/architecture/API_CONTRACTS.md`) and it arrives here untransformed.
     * `0.75` means 75%; the conversion to a percentage happens below, at the
     * render site, and nowhere else.
     */
    responseRate: Ratio;
    inReview: number; // phone_screen + interview count
  };
  loading?: boolean;
  /**
   * The dashboard request failed, so no figure below can be stated.
   *
   * Distinct from `loading` rather than folded into it, for the same reason as
   * `DashboardResumeWidget`: a failed query never settles, so the skeleton would animate
   * forever.
   */
  error?: boolean;
}

/**
 * DashboardStats Component
 * Display key metrics at a glance
 */
export function DashboardStats({ stats, loading = false, error = false }: DashboardStatsProps) {
  // Ahead of the skeleton: a failed request has no settled state to wait for.
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-red-700">Failed to load your dashboard statistics. Please try again.</p>
      </div>
    );
  }

  // `!stats` is not redundant with `loading`, and it is not defensive padding: it is what
  // keeps the numbers below unreachable without a measurement. A caller that forgets to
  // pass `loading` still cannot make this component state a figure it was never given.
  if (loading || !stats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {STAT_LABELS.map((label) => (
          <StatCardSkeleton key={label} />
        ))}
      </div>
    );
  }

  // Stat configuration. Each entry carries its final display string: the unit
  // conversion belongs next to the value it applies to, not in a shared
  // `formatValue` that a differently-united number could be routed through.
  const statItems = [
    { display: stats.total.toString(), label: STAT_LABELS[0] },
    { display: stats.appliedThisWeek.toString(), label: STAT_LABELS[1] },
    { display: `${Math.round(toPercent(stats.responseRate))}%`, label: STAT_LABELS[2] },
    { display: stats.inReview.toString(), label: STAT_LABELS[3] },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {statItems.map((stat, index) => (
        <StatCard key={index} value={stat.display} label={stat.label} />
      ))}
    </div>
  );
}

/**
 * Individual Stat Card
 */
interface StatCardProps {
  value: string;
  label: string;
}

function StatCard({ value, label }: StatCardProps) {
  return (
    <div
      className="bg-white rounded-lg border border-neutral-200 p-6
                 shadow-sm hover:shadow-md
                 transition-all duration-200
                 hover:scale-[1.02]
                 flex flex-col items-center justify-center
                 text-center"
    >
      <div className="text-3xl font-bold text-primary-600 mb-1">{value}</div>
      <div className="text-sm text-neutral-600">{label}</div>
    </div>
  );
}

/**
 * Loading Skeleton for Stat Card
 */
function StatCardSkeleton() {
  return (
    <div
      className="bg-white rounded-lg border border-neutral-200 p-6
                 shadow-sm flex flex-col items-center justify-center
                 text-center"
      role="status"
      aria-label="Loading statistics"
    >
      {/* Value skeleton */}
      <div
        className="h-9 w-16 bg-neutral-200 rounded mb-1
                   animate-pulse"
        aria-hidden="true"
      />
      {/* Label skeleton */}
      <div
        className="h-4 w-20 bg-neutral-200 rounded
                   animate-pulse"
        aria-hidden="true"
      />
    </div>
  );
}
