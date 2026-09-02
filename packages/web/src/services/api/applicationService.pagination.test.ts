import { describe, expect, it, vi } from 'vitest';

import {
  ApplicationService,
  APPLICATION_PAGE_SIZE,
  MAX_APPLICATION_PAGES,
} from './applicationService';
import type { APIClient } from './apiClient';

/**
 * WIC-1478 / AC-N1b: no client surface may silently discard `nextPage`.
 *
 * `GET /api/applications` is paged (default 50, max 100) and ordered by
 * most-recently-updated. The old `getAll()` issued one unparameterised request
 * and returned `response.applications`, dropping `nextPage` and `totalCount` on
 * the floor — so every caller silently received a prefix of the account and had
 * no way to tell.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function seedRows(count: number, staleCount: number) {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const isStale = i >= count - staleCount;
    return {
      id: `app-${i}`,
      jobTitle: `Engineer ${i}`,
      company: `Company ${i}`,
      status: 'applied' as const,
      version: 1,
      createdAt: new Date(now - 60 * DAY_MS).toISOString(),
      // Newest-first, matching the server's `desc(updatedAt)` default order.
      updatedAt: new Date(now - (isStale ? 30 * DAY_MS : i * 60 * 1000)).toISOString(),
    };
  });
}

/**
 * A stand-in for `APIClient` that pages exactly the way the API does: honours
 * `limit` (capped at 100), uses `page` as an opaque cursor, and omits `nextPage`
 * on the final page.
 */
function pagingClient(rows: ReturnType<typeof seedRows>) {
  const urls: string[] = [];

  const get = vi.fn(async (endpoint: string) => {
    urls.push(endpoint);
    const url = new URL(endpoint, 'http://localhost');
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 100);
    const offset = Number(url.searchParams.get('page') ?? 0);
    const slice = rows.slice(offset, offset + limit);
    return {
      applications: slice,
      nextPage: offset + limit < rows.length ? String(offset + limit) : undefined,
      totalCount: rows.length,
    };
  });

  return { client: { get } as unknown as APIClient, urls, get };
}

describe('ApplicationService.getAllPaged (WIC-1478)', () => {
  it('follows nextPage to exhaustion instead of returning the first page', async () => {
    const rows = seedRows(150, 40);
    const { client, urls } = pagingClient(rows);

    const result = await new ApplicationService(client).getAllPaged();

    expect(result.applications).toHaveLength(150);
    expect(result.totalCount).toBe(150);
    expect(result.truncated).toBe(false);
    // 150 rows at the maximum page size is two requests, not one.
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain(`limit=${APPLICATION_PAGE_SIZE}`);
    expect(urls[1]).toContain('page=100');
  });

  it('recovers the stale rows a single default page cannot reach', async () => {
    // The discriminator: with 150 rows ordered newest-first and the 40 stale
    // ones at the tail, no single page — 50 or even the 100 maximum — contains
    // a single stale row. Only exhaustion finds them.
    const rows = seedRows(150, 40);
    // Accepts both the wire shape (ISO string) and the transformed one (Date).
    const isStale = (r: { updatedAt: string | Date }) =>
      Date.now() - new Date(r.updatedAt).getTime() > 7 * DAY_MS;

    expect(rows.slice(0, 50).filter(isStale)).toHaveLength(0);
    expect(rows.slice(0, APPLICATION_PAGE_SIZE).filter(isStale)).toHaveLength(0);

    const { client } = pagingClient(rows);
    const result = await new ApplicationService(client).getAllPaged();

    expect(result.applications.filter(isStale)).toHaveLength(40);
  });

  it('makes a single request and reports no truncation for a small account', async () => {
    const { client, urls } = pagingClient(seedRows(12, 3));

    const result = await new ApplicationService(client).getAllPaged();

    expect(urls).toHaveLength(1);
    expect(result.applications).toHaveLength(12);
    expect(result.truncated).toBe(false);
  });

  it('forwards filters on every page, not just the first', async () => {
    const { client, urls } = pagingClient(seedRows(150, 0));

    await new ApplicationService(client).getAllPaged({
      status: ['applied', 'interview'],
      company: 'Acme',
      search: 'engineer',
    });

    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url).toContain('status=applied%2Cinterview');
      expect(url).toContain('company=Acme');
      expect(url).toContain('search=engineer');
    }
  });

  it('reports truncated=true rather than silently returning a prefix', async () => {
    // A server that never stops handing out cursors. The point is not the loop
    // guard itself but that hitting it is *visible* to the caller.
    const get = vi.fn(async () => ({
      applications: [{ id: 'x', jobTitle: 't', company: 'c', status: 'applied', version: 1 }],
      nextPage: 'always-more',
      totalCount: 99999,
    }));

    const result = await new ApplicationService({ get } as unknown as APIClient).getAllPaged();

    expect(get).toHaveBeenCalledTimes(MAX_APPLICATION_PAGES);
    expect(result.truncated).toBe(true);
    expect(result.totalCount).toBe(99999);
    expect(result.applications).toHaveLength(MAX_APPLICATION_PAGES);
  });

  it('getAll() is the same fetch, projected to rows', async () => {
    const { client } = pagingClient(seedRows(150, 40));

    const applications = await new ApplicationService(client).getAll();

    expect(applications).toHaveLength(150);
    // Dates are transformed, not passed through as ISO strings.
    expect(applications[0].updatedAt).toBeInstanceOf(Date);
  });
});
