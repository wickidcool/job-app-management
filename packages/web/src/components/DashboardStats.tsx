export interface DashboardStatsProps {
  stats: {
    total: number;
    appliedThisWeek: number;
    responseRate: number; // 0-100
    inReview: number; // phone_screen + interview count
  };
  loading?: boolean;
}

/**
 * DashboardStats Component
 * Display key metrics at a glance
 */
export function DashboardStats({ stats, loading = false }: DashboardStatsProps) {
  // Stat configuration
  const statItems = [
    {
      value: stats.total,
      label: 'Total',
      formatValue: (val: number) => val.toString(),
    },
    {
      value: stats.appliedThisWeek,
      label: 'This Week',
      formatValue: (val: number) => val.toString(),
    },
    {
      value: stats.responseRate,
      label: 'Response',
      formatValue: (val: number) => `${Math.round(val)}%`,
    },
    {
      value: stats.inReview,
      label: 'In Review',
      formatValue: (val: number) => val.toString(),
    },
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
        <StatCard
          key={index}
          value={stat.formatValue(stat.value)}
          label={stat.label}
        />
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
      <div className="text-3xl font-bold text-primary-600 mb-1">
        {value}
      </div>
      <div className="text-sm text-neutral-600">
        {label}
      </div>
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
