import { useState, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import type { Application, ApplicationStatus } from '../types/application';

interface ApplicationsTableProps {
  applications: Application[];
  onRowClick?: (id: string) => void;
}

type SortColumn = 'company' | 'jobTitle' | 'status' | 'updatedAt' | 'appliedAt';
type SortDirection = 'asc' | 'desc';

function SortIndicator({
  column,
  sortColumn,
  sortDirection,
}: {
  column: SortColumn;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
}) {
  if (sortColumn !== column) return null;
  return (
    <span className="ml-1" aria-hidden="true">
      {sortDirection === 'asc' ? '▲' : '▼'}
    </span>
  );
}

export function ApplicationsTable({ applications, onRowClick }: ApplicationsTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('updatedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const sortedApplications = useMemo(() => {
    const sorted = [...applications].sort((a, b) => {
      let aValue: string | Date | undefined;
      let bValue: string | Date | undefined;

      switch (sortColumn) {
        case 'company':
          aValue = a.company.toLowerCase();
          bValue = b.company.toLowerCase();
          break;
        case 'jobTitle':
          aValue = a.jobTitle.toLowerCase();
          bValue = b.jobTitle.toLowerCase();
          break;
        case 'status':
          aValue = a.status;
          bValue = b.status;
          break;
        case 'updatedAt':
          aValue = a.updatedAt;
          bValue = b.updatedAt;
          break;
        case 'appliedAt':
          aValue = a.appliedAt;
          bValue = b.appliedAt;
          break;
      }

      if (aValue === undefined && bValue === undefined) return 0;
      if (aValue === undefined) return 1;
      if (bValue === undefined) return -1;

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [applications, sortColumn, sortDirection]);

  const getStatusColor = (status: ApplicationStatus): string => {
    const colors: Record<ApplicationStatus, string> = {
      saved: 'text-neutral-600',
      applied: 'text-blue-600',
      phone_screen: 'text-purple-600',
      interview: 'text-yellow-600',
      offer: 'text-green-600',
      rejected: 'text-red-600',
      withdrawn: 'text-gray-500',
    };
    return colors[status];
  };

  const formatStatus = (status: ApplicationStatus): string => {
    const labels: Record<ApplicationStatus, string> = {
      saved: 'Saved',
      applied: 'Applied',
      phone_screen: 'Phone Screen',
      interview: 'Interview',
      offer: 'Offer',
      rejected: 'Rejected',
      withdrawn: 'Withdrawn',
    };
    return labels[status];
  };

  if (applications.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-neutral-500">No applications found</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto bg-white rounded-lg border border-neutral-200">
      <table className="min-w-full divide-y divide-neutral-200">
        <thead className="bg-neutral-50">
          <tr>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-bold text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100"
              onClick={() => handleSort('company')}
            >
              Company{' '}
              <SortIndicator
                column="company"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
              />
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-bold text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100"
              onClick={() => handleSort('jobTitle')}
            >
              Role{' '}
              <SortIndicator
                column="jobTitle"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
              />
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-bold text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100"
              onClick={() => handleSort('status')}
            >
              Status{' '}
              <SortIndicator
                column="status"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
              />
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-bold text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100"
              onClick={() => handleSort('updatedAt')}
            >
              Last Status Change{' '}
              <SortIndicator
                column="updatedAt"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
              />
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-bold text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100"
              onClick={() => handleSort('appliedAt')}
            >
              Applied Date{' '}
              <SortIndicator
                column="appliedAt"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
              />
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-neutral-200">
          {sortedApplications.map((app) => (
            <tr
              key={app.id}
              className="hover:bg-neutral-50 cursor-pointer"
              onClick={() => onRowClick?.(app.id)}
            >
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-neutral-900">
                {app.company}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-700">
                {app.jobTitle}
              </td>
              <td
                className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${getStatusColor(app.status)}`}
              >
                {formatStatus(app.status)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500">
                {formatDistanceToNow(new Date(app.updatedAt), { addSuffix: true })}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500">
                {app.appliedAt ? new Date(app.appliedAt).toLocaleDateString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
