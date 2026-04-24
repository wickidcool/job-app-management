import { useState } from 'react';
import type {
  CompanyCatalogEntry,
  TechStackTag,
  JobFitTag,
  QuantifiedBullet,
  CatalogEntry,
} from '../../types/catalog';

type CatalogType = 'companies' | 'techStackTags' | 'jobFitTags' | 'quantifiedBullets';

interface CatalogBrowseTableProps {
  catalogType: CatalogType;
  data: CatalogEntry[];
  onSort?: (column: string, direction: 'asc' | 'desc') => void;
  onRowClick?: (id: string) => void;
}

export function CatalogBrowseTable({
  catalogType,
  data,
  onSort,
  onRowClick,
}: CatalogBrowseTableProps) {
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleSort = (column: string) => {
    const newDirection =
      sortColumn === column && sortDirection === 'asc' ? 'desc' : 'asc';
    setSortColumn(column);
    setSortDirection(newDirection);
    onSort?.(column, newDirection);
  };

  const SortIndicator = ({ column }: { column: string }) => {
    if (sortColumn !== column) return null;
    return (
      <span className="ml-1" aria-hidden="true">
        {sortDirection === 'asc' ? '▲' : '▼'}
      </span>
    );
  };

  const renderCompaniesTable = (companies: CompanyCatalogEntry[]) => (
    <table className="min-w-full divide-y divide-neutral-200">
      <thead className="bg-neutral-50">
        <tr>
          <th
            scope="col"
            className="px-6 py-3 text-left text-xs font-bold text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100"
            onClick={() => handleSort('name')}
          >
            Name <SortIndicator column="name" />
          </th>
          <th
            scope="col"
            className="px-6 py-3 text-left text-xs font-bold text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100"
            onClick={() => handleSort('applicationCount')}
          >
            Applications <SortIndicator column="applicationCount" />
          </th>
          <th
            scope="col"
            className="px-6 py-3 text-left text-xs font-bold text-neutral-600 uppercase tracking-wider"
          >
            Latest Status
          </th>
          <th
            scope="col"
            className="px-6 py-3 text-left text-xs font-bold text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100"
            onClick={() => handleSort('firstSeen')}
          >
            First Seen <SortIndicator column="firstSeen" />
          </th>
        </tr>
      </thead>
      <tbody className="bg-white divide-y divide-neutral-200">
        {companies.map((company) => (
          <tr
            key={company.id}
            className="hover:bg-neutral-50 cursor-pointer"
            onClick={() => onRowClick?.(company.id)}
          >
            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-neutral-900">
              {company.name}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-700">
              {company.applicationCount}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-700">
              {company.latestStatus}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500">
              {new Date(company.firstSeen).toLocaleDateString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const renderTagsTable = (tags: (TechStackTag | JobFitTag)[]) => (
    <table className="min-w-full divide-y divide-neutral-200">
      <thead className="bg-neutral-50">
        <tr>
          <th
            scope="col"
            className="px-6 py-3 text-left text-xs font-bold text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100"
            onClick={() => handleSort('tag')}
          >
            Tag <SortIndicator column="tag" />
          </th>
          <th
            scope="col"
            className="px-6 py-3 text-left text-xs font-bold text-neutral-600 uppercase tracking-wider"
          >
            Category
          </th>
          <th
            scope="col"
            className="px-6 py-3 text-left text-xs font-bold text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100"
            onClick={() => handleSort('mentionCount')}
          >
            Mentions <SortIndicator column="mentionCount" />
          </th>
          {'yearsExperience' in tags[0] && (
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-bold text-neutral-600 uppercase tracking-wider"
            >
              Years
            </th>
          )}
          <th
            scope="col"
            className="px-6 py-3 text-left text-xs font-bold text-neutral-600 uppercase tracking-wider"
          >
            Sources
          </th>
        </tr>
      </thead>
      <tbody className="bg-white divide-y divide-neutral-200">
        {tags.map((tag) => (
          <tr
            key={tag.id}
            className="hover:bg-neutral-50 cursor-pointer"
            onClick={() => onRowClick?.(tag.id)}
          >
            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-neutral-900">
              {tag.displayName}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-700">
              {tag.category}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-700">
              {tag.mentionCount}
            </td>
            {'yearsExperience' in tag && (
              <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-700">
                {tag.yearsExperience || '—'}
              </td>
            )}
            <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500">
              {tag.sourceIds.length} source{tag.sourceIds.length !== 1 ? 's' : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const renderBulletsTable = (bullets: QuantifiedBullet[]) => (
    <table className="min-w-full divide-y divide-neutral-200">
      <thead className="bg-neutral-50">
        <tr>
          <th
            scope="col"
            className="px-6 py-3 text-left text-xs font-bold text-neutral-600 uppercase tracking-wider"
          >
            Bullet
          </th>
          <th
            scope="col"
            className="px-6 py-3 text-left text-xs font-bold text-neutral-600 uppercase tracking-wider"
          >
            Impact
          </th>
          <th
            scope="col"
            className="px-6 py-3 text-left text-xs font-bold text-neutral-600 uppercase tracking-wider"
          >
            Source
          </th>
        </tr>
      </thead>
      <tbody className="bg-white divide-y divide-neutral-200">
        {bullets.map((bullet) => (
          <tr
            key={bullet.id}
            className="hover:bg-neutral-50 cursor-pointer"
            onClick={() => onRowClick?.(bullet.id)}
          >
            <td className="px-6 py-4 text-sm text-neutral-900">
              <div className="max-w-2xl">
                {bullet.bulletText}
                <div className="mt-1 space-x-4 text-xs text-neutral-500">
                  <span>• Metric: {bullet.metricType} {bullet.metricValue}</span>
                </div>
              </div>
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-700">
              {bullet.impactCategory}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500">
              {bullet.sourceName}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (data.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-neutral-500">No entries found in catalog</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      {catalogType === 'companies' &&
        renderCompaniesTable(data as CompanyCatalogEntry[])}
      {(catalogType === 'techStackTags' || catalogType === 'jobFitTags') &&
        renderTagsTable(data as (TechStackTag | JobFitTag)[])}
      {catalogType === 'quantifiedBullets' &&
        renderBulletsTable(data as QuantifiedBullet[])}
    </div>
  );
}
