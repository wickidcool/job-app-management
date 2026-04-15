/**
 * API Service Module
 *
 * This module provides the real API integration for the Job Application Manager.
 * When the backend is ready, import from this module instead of mockApplicationService.
 *
 * Usage:
 * ```typescript
 * import { applicationService } from './services/api';
 *
 * // Use exactly like mockApplicationService
 * const apps = await applicationService.getAll();
 * ```
 */

import { createAPIClient } from './apiClient';
import { createApplicationService } from './applicationService';

// API Configuration
// TODO: Replace with actual API URL when backend is deployed
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://api-dev.jobapp.example.com/v1';

/**
 * Get authentication token
 * TODO: Implement actual Cognito authentication
 */
async function getAuthToken(): Promise<string | null> {
  // For now, return null (will fail auth-required requests)
  // When backend is ready, integrate with Cognito:
  // 1. Use AWS Amplify or similar
  // 2. Return the ID token from authenticated user
  // 3. Handle token refresh
  return null;
}

// Create API client
export const apiClient = createAPIClient({
  baseURL: API_BASE_URL,
  getAuthToken,
});

// Create application service
export const applicationService = createApplicationService(apiClient);

// Re-export types for convenience
export type { ApplicationService } from './applicationService';
export type { APIClient, APIError } from './apiClient';
export type * from './types';
