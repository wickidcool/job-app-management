import type { APIConfig, APIErrorResponse } from './types';

export class APIError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'APIError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class APIClient {
  config: APIConfig;

  constructor(config: APIConfig) {
    this.config = config;
  }

  /**
   * Make an authenticated API request
   */
  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.config.getAuthToken();

    // Every endpoint reachable through this client is user-scoped and behind the
    // Worker's JWT middleware — `/auth/*` is the one unauthenticated surface the app
    // has, and `AuthContext` calls it with bare `fetch`, never through here. So "no
    // token" is never a request worth sending: the server can only answer 401, and the
    // 401 branch below tears down the session by design.
    //
    // That turns a harmless race into a sign-out. A component holding a protected
    // query can mount (or refetch) in the window before `AuthContext` has written the
    // token, or in the instant after a sign-out clears it; the request goes out bare,
    // comes back 401, and `auth:unauthorized` wipes the session the user was in the
    // middle of establishing. Measured as five failing isolation specs whose one cause
    // was an unauthenticated `GET /applications?limit=100` racing login (WIC-2384).
    //
    // Failing locally keeps that window closed for every service at once, which is why
    // this lives here rather than as an `enabled:` guard on one hook. It deliberately
    // does NOT dispatch `auth:unauthorized`: no server said the session was invalid,
    // and `AuthContext` documents this file as that event's only dispatch site.
    if (!token) {
      throw new APIError(
        'UNAUTHENTICATED',
        'No authentication token available; request not sent.',
        401
      );
    }

    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    // Don't set Content-Type for FormData - let browser set it with boundary
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    // Unconditional: the early return above is what makes this total. Every request
    // this client sends carries an Authorization header, which is the invariant
    // `multi-user-isolation.spec.ts` asserts on the wire.
    headers['Authorization'] = `Bearer ${token}`;

    const url = `${this.config.baseURL}${endpoint}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      // Handle different status codes
      if (response.status === 204) {
        // No content (successful delete)
        return undefined as T;
      }

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          window.dispatchEvent(new CustomEvent('auth:unauthorized'));
        }
        const error = data as APIErrorResponse;
        throw new APIError(
          error.error.code,
          error.error.message,
          response.status,
          error.error.details
        );
      }

      return data as T;
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }

      // Network or parse error
      throw new APIError(
        'NETWORK_ERROR',
        error instanceof Error ? error.message : 'Network request failed',
        0
      );
    }
  }

  /**
   * GET request
   */
  async get<T>(endpoint: string, params?: Record<string, string | number | undefined>): Promise<T> {
    let queryString = '';
    if (params) {
      const filtered = Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
      );
      if (Object.keys(filtered).length > 0) {
        queryString = '?' + new URLSearchParams(filtered as Record<string, string>).toString();
      }
    }

    return this.request<T>(`${endpoint}${queryString}`, {
      method: 'GET',
    });
  }

  /**
   * POST request
   */
  async post<T>(
    endpoint: string,
    body?: unknown,
    customHeaders?: Record<string, string>
  ): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
      headers: customHeaders,
    });
  }

  /**
   * PUT request
   */
  async put<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * PATCH request
   */
  async patch<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * DELETE request
   */
  async delete<T = void>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'DELETE',
    });
  }
}

/**
 * Create API client instance
 */
export function createAPIClient(config: APIConfig): APIClient {
  return new APIClient(config);
}
