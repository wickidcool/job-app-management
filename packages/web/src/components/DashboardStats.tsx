import { APPLIED_WINDOW_LABEL } from '../constants/appliedWindow';
import { toPercent, type Ratio } from '../types/units';

export interface DashboardStatsProps {
  stats: {
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
}

/**
 * DashboardStats Component
 * Display key metrics at a glance
 */
export function DashboardStats({ stats, loading = false }: DashboardStatsProps) {
  // Stat configuration. Each entry carries its final display string: the unit
  // conversion belongs next to the value it applies to, not in a shared
  // `formatValue` that a differently-united number could be routed through.
  const statItems = [
    { display: stats.total.toString(), label: 'Total' },
    // Rolling window, not the current calendar week — see constants/appliedWindow.ts.
    { display: stats.appliedThisWeek.toString(), label: APPLIED_WINDOW_LABEL },
    { display: `${Math.round(toPercent(stats.responseRate))}%`, label: 'Response' },
    { display: stats.inReview.toString(), label: 'In Review' },
  ];

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statItems.map((_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>
    );
  }

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
