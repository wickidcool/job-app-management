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
import { createDashboardService } from './dashboardService';
import { createResumeService } from './resumeService';
import { createProjectService } from './projectService';
import { createCatalogService } from './catalog.service';
import { createReportsService } from './reportsService';
import { createJobFitService } from './jobFitService';
import { createCoverLetterService } from './coverLetters';

// API Configuration
// Local backend runs on port 3000
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

/**
 * Get authentication token
 * Single-user mode: no authentication required for local backend
 */
async function getAuthToken(): Promise<string | null> {
  // Local single-user mode - no auth required
  return null;
}

// Create API client
export const apiClient = createAPIClient({
  baseURL: API_BASE_URL,
  getAuthToken,
});

// Create services
export const applicationService = createApplicationService(apiClient);
export const dashboardService = createDashboardService(apiClient);
export const resumeService = createResumeService(apiClient);
export const projectService = createProjectService(apiClient);
export const catalogService = createCatalogService(apiClient);
export const reportsService = createReportsService(apiClient);
export const jobFitService = createJobFitService(apiClient);
export const coverLetterService = createCoverLetterService(apiClient);

// Re-export types for convenience
export type { ApplicationService } from './applicationService';
export type { APIClient, APIError } from './apiClient';
export type { DashboardService } from './dashboardService';
export type { ResumeService, Resume } from './resumeService';
export type { ProjectService, Project, ProjectFile, CreateProjectInput } from './projectService';
export type { CatalogService } from './catalog.service';
export type {
  ReportsService,
  UrgencyLevel,
  ActiveStatus,
  FitTier,
  ClosedStatus,
  PipelineApplication,
  PipelineGroup,
  PipelineReportResponse,
  NeedsActionApplication,
  NeedsActionReportResponse,
  StaleApplication,
  StaleReportResponse,
  ClosedLoopApplication,
  RejectionStageStats,
  ClosedLoopReportResponse,
  FitTierApplication,
  FitTierGroup,
  ByFitTierReportResponse,
} from './reportsService';
export type { JobFitService } from './jobFitService';
export type { CoverLetterService, CoverLetter } from './coverLetters';
export type * from './types';
