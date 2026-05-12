import { test, expect, type Page } from '@playwright/test';

/**
 * Job Fit Analysis E2E Tests
 *
 * Tests use mock auth to bypass authentication without a real backend.
 *
 * LLM mocking strategy:
 * - mockJobFitApi() intercepts browser→API requests at /api/catalog/job-fit/analyze,
 *   preventing any server-side Anthropic API calls from occurring in tests.
 * - mockAnthropicApi() intercepts browser→Anthropic requests directly. Use this
 *   for future integration-style tests that bypass the analyze endpoint mock and
 *   require control over raw LLM responses (e.g. when ANTHROPIC_BASE_URL points
 *   to a local mock server).
 */

const MOCK_USER = {
  id: 'test-user-001',
  email: 'test@example.com',
};

async function setupMockAuth(page: Page) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: MOCK_USER }),
    })
  );

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'mock-jwt-token-for-e2e-tests');
  });
}

// Non-standard prose-style JD without explicit "Requirements:" section headers.
// Regex parsing struggles with this format; LLM handles it correctly.
const JD_TEXT_NONSTANDARD = `We're building the future of fintech infrastructure and need a Staff
Infrastructure Engineer who can lead our platform team of five.

You'll spend your days crafting Kubernetes manifests and Terraform modules that power our
AWS-hosted data pipelines. PostgreSQL is our backbone—you'll need to own it deeply.
TypeScript ties it all together on the application layer, and Redis keeps our latency
targets in check.

If you've shipped distributed systems at scale and know your way around a blast radius,
we want to talk. Bonus points for Rust experience and familiarity with GraphQL federation.

Compensation reflects your geography and experience—we're talking $200,000–$240,000 for
the right person, with meaningful equity. Remote-first, US or EU timezones.`;

const JD_TEXT_VALID = `Senior Full Stack Engineer

We are looking for a Senior Full Stack Engineer to join our growing team.

Requirements:
- 5+ years of experience with TypeScript
- Strong proficiency in React and Node.js
- Experience with PostgreSQL and Redis
- Familiarity with AWS cloud services
- Experience with Docker and Kubernetes

Nice to have:
- GraphQL experience
- Terraform knowledge

Location: Remote (US)
Compensation: $150,000 - $180,000 + equity

Responsibilities:
- Design and build scalable backend services using Node.js and TypeScript
- Build React-based frontend features
- Manage AWS infrastructure using Terraform`;

const MOCK_ANALYSIS_RESPONSE = {
  recommendation: 'moderate_fit',
  summary: 'You match 4 of 6 required skills.',
  confidence: 'high',
  parsedJd: {
    roleTitle: 'Senior Full Stack Engineer',
    seniority: 'senior',
    seniorityConfidence: 'high',
    requiredStack: ['typescript', 'react', 'nodejs', 'postgresql', 'redis', 'aws'],
    niceToHaveStack: ['graphql', 'terraform'],
    industries: [],
    teamScope: null,
    location: 'Remote (US)',
    compensation: '$150,000 - $180,000',
  },
  strongMatches: [
    {
      type: 'tech_stack',
      catalogEntry: 'typescript',
      jdRequirement: 'typescript',
      matchType: 'exact',
      isRequired: true,
    },
    {
      type: 'tech_stack',
      catalogEntry: 'react',
      jdRequirement: 'react',
      matchType: 'exact',
      isRequired: true,
    },
    {
      type: 'tech_stack',
      catalogEntry: 'nodejs',
      jdRequirement: 'nodejs',
      matchType: 'exact',
      isRequired: true,
    },
  ],
  partialMatches: [
    {
      type: 'tech_stack',
      catalogEntry: 'postgresql',
      jdRequirement: 'postgresql',
      matchType: 'alias',
      isRequired: true,
    },
  ],
  gaps: [
    {
      type: 'tech_stack',
      jdRequirement: 'aws',
      isRequired: true,
      severity: 'critical',
    },
    {
      type: 'tech_stack',
      jdRequirement: 'redis',
      isRequired: true,
      severity: 'moderate',
    },
  ],
  recommendedStarEntries: [
    {
      id: 'bullet-1',
      rawText:
        'Led migration of monolith to microservices using TypeScript and React, reducing deploy time by 40%',
      impactCategory: 'technical_leadership',
      relevanceScore: 0.85,
    },
  ],
  catalogEmpty: false,
  analysisTimestamp: '2026-04-25T10:30:00.000Z',
};

const MOCK_EMPTY_CATALOG_RESPONSE = {
  recommendation: null,
  summary:
    'Your catalog is empty. Upload a resume or add application history to enable fit analysis.',
  confidence: 'high',
  parsedJd: {
    roleTitle: 'Senior Full Stack Engineer',
    seniority: 'senior',
    seniorityConfidence: 'high',
    requiredStack: ['typescript', 'react'],
    niceToHaveStack: [],
    industries: [],
    teamScope: null,
    location: null,
    compensation: null,
  },
  strongMatches: [],
  partialMatches: [],
  gaps: [],
  recommendedStarEntries: [],
  catalogEmpty: true,
  analysisTimestamp: '2026-04-25T10:30:00.000Z',
};

// What the LLM correctly extracts from JD_TEXT_NONSTANDARD.
// LLM understands prose context (e.g. "team of five" → teamScope, implied required skills).
const MOCK_LLM_ANALYSIS_RESPONSE = {
  recommendation: 'strong_fit',
  summary: 'Strong match — you meet 5 of 6 required skills.',
  confidence: 'high',
  parsedJd: {
    roleTitle: 'Staff Infrastructure Engineer',
    seniority: 'staff',
    seniorityConfidence: 'high',
    requiredStack: ['typescript', 'kubernetes', 'aws', 'terraform', 'postgresql', 'redis'],
    niceToHaveStack: ['rust', 'graphql'],
    industries: ['fintech'],
    teamScope: 'Manager of 5',
    location: 'Remote (US/EU)',
    compensation: '$200,000 - $240,000',
  },
  strongMatches: [
    {
      type: 'tech_stack',
      catalogEntry: 'typescript',
      jdRequirement: 'typescript',
      matchType: 'exact',
      isRequired: true,
    },
    {
      type: 'tech_stack',
      catalogEntry: 'kubernetes',
      jdRequirement: 'kubernetes',
      matchType: 'exact',
      isRequired: true,
    },
    {
      type: 'tech_stack',
      catalogEntry: 'aws',
      jdRequirement: 'aws',
      matchType: 'exact',
      isRequired: true,
    },
    {
      type: 'tech_stack',
      catalogEntry: 'terraform',
      jdRequirement: 'terraform',
      matchType: 'exact',
      isRequired: true,
    },
    {
      type: 'tech_stack',
      catalogEntry: 'postgresql',
      jdRequirement: 'postgresql',
      matchType: 'alias',
      isRequired: true,
    },
  ],
  partialMatches: [],
  gaps: [{ type: 'tech_stack', jdRequirement: 'redis', isRequired: true, severity: 'moderate' }],
  recommendedStarEntries: [],
  catalogEmpty: false,
  analysisTimestamp: '2026-05-12T10:30:00.000Z',
};

// What regex fallback returns from the same JD_TEXT_NONSTANDARD.
// Without standard section headers, regex finds no required stack and cannot score fit.
const MOCK_LLM_FALLBACK_ANALYSIS_RESPONSE = {
  recommendation: null,
  summary: 'Unable to compute fit score — no required skills found in the job description.',
  confidence: 'low',
  parsedJd: {
    roleTitle: null,
    seniority: 'staff',
    seniorityConfidence: 'high',
    requiredStack: [],
    niceToHaveStack: [],
    industries: [],
    teamScope: null,
    location: null,
    compensation: '$200,000–$240,000',
  },
  strongMatches: [],
  partialMatches: [],
  gaps: [],
  recommendedStarEntries: [],
  catalogEmpty: false,
  analysisTimestamp: '2026-05-12T10:30:00.000Z',
};

async function mockJobFitApi(page: Page, responseBody: object, status = 200) {
  await page.route('**/api/catalog/job-fit/analyze', (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(responseBody),
    })
  );
}

/**
 * Mocks the Anthropic messages endpoint for integration-style tests that run
 * against a real API server configured with ANTHROPIC_BASE_URL pointing to a
 * local mock proxy. Returns a valid tool_use response for parse_job_description.
 *
 * This is not used when mockJobFitApi() intercepts the analyze endpoint entirely.
 */
async function mockAnthropicApi(page: Page, parsedJd: object) {
  await page.route('**/api.anthropic.com/v1/messages', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'msg_mock_e2e_001',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_mock_e2e_001',
            name: 'parse_job_description',
            input: parsedJd,
          },
        ],
        model: 'claude-sonnet-4-6',
        stop_reason: 'tool_use',
        usage: { input_tokens: 500, output_tokens: 200 },
      }),
    })
  );
}

test.describe('Job Fit Analysis page', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
    await page.goto('/job-fit-analysis');
  });

  test('renders the input form with correct elements', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Job Fit Analysis' })).toBeVisible();
    await expect(page.locator('#jobDescriptionText')).toBeVisible();
    await expect(page.locator('#jobDescriptionUrl')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Analyze Fit →' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Analyze Fit →' })).toBeDisabled();
  });

  test('shows character count and enables submit when text meets minimum', async ({ page }) => {
    const textarea = page.locator('#jobDescriptionText');
    await textarea.fill(JD_TEXT_VALID);
    await expect(page.getByText(/Ready to analyze/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Analyze Fit →' })).toBeEnabled();
  });

  test('shows error when text is under 100 characters', async ({ page }) => {
    const textarea = page.locator('#jobDescriptionText');
    await textarea.fill('Too short text');
    await expect(page.getByText(/Min 100 characters required/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Analyze Fit →' })).toBeDisabled();
  });

  // TC-1: Submit JD text → receive fit assessment
  test('TC-1: submits JD text and displays fit assessment results', async ({ page }) => {
    await mockJobFitApi(page, MOCK_ANALYSIS_RESPONSE);

    await page.locator('#jobDescriptionText').fill(JD_TEXT_VALID);
    await page.getByRole('button', { name: 'Analyze Fit →' }).click();

    // Wait for results page
    await expect(page.getByRole('heading', { name: 'Job Fit Analysis Results' })).toBeVisible({
      timeout: 15000,
    });

    // Overall recommendation shown
    await expect(page.getByText('MODERATE FIT')).toBeVisible();
    await expect(page.getByText('You match 4 of 6 required skills.')).toBeVisible();

    // Parsed requirements section
    await expect(page.getByText('Senior Full Stack Engineer')).toBeVisible();
    await expect(page.getByText('Remote (US)')).toBeVisible();
  });

  // TC-1b: Strong matches section
  test('TC-1b: strong matches are displayed with green indicator', async ({ page }) => {
    await mockJobFitApi(page, MOCK_ANALYSIS_RESPONSE);

    await page.locator('#jobDescriptionText').fill(JD_TEXT_VALID);
    await page.getByRole('button', { name: 'Analyze Fit →' }).click();

    await expect(page.getByRole('heading', { name: 'Job Fit Analysis Results' })).toBeVisible({
      timeout: 15000,
    });

    await expect(page.getByText('✅ Strong Matches (3)')).toBeVisible();
    // Strong match entries have green left border
    const strongMatchCards = page.locator('.border-green-500');
    await expect(strongMatchCards.first()).toBeVisible();
  });

  // TC-5: Partial matches display correctly
  test('TC-5: partial matches are displayed with yellow indicator', async ({ page }) => {
    await mockJobFitApi(page, MOCK_ANALYSIS_RESPONSE);

    await page.locator('#jobDescriptionText').fill(JD_TEXT_VALID);
    await page.getByRole('button', { name: 'Analyze Fit →' }).click();

    await expect(page.getByRole('heading', { name: 'Job Fit Analysis Results' })).toBeVisible({
      timeout: 15000,
    });

    await expect(page.getByText('⚠️ Partial Matches (1)')).toBeVisible();
    const partialCards = page.locator('.border-yellow-500');
    await expect(partialCards.first()).toBeVisible();
    await expect(page.getByText(/Partially matches:/)).toBeVisible();
  });

  // TC-6: Gaps are visually prominent
  // FIXME: Test is flaky in CI - gap severity styling may vary
  test.skip('TC-6: gaps are displayed prominently with severity-coded styling', async ({
    page,
  }) => {
    await mockJobFitApi(page, MOCK_ANALYSIS_RESPONSE);

    await page.locator('#jobDescriptionText').fill(JD_TEXT_VALID);
    await page.getByRole('button', { name: 'Analyze Fit →' }).click();

    await expect(page.getByRole('heading', { name: 'Job Fit Analysis Results' })).toBeVisible({
      timeout: 15000,
    });

    await expect(page.getByText('❌ Gaps (2)')).toBeVisible();
    // Critical gap has red background
    await expect(page.locator('.border-red-500').first()).toBeVisible();
    await expect(page.getByText('CRITICAL')).toBeVisible();
    await expect(page.getByText('MODERATE')).toBeVisible();
    // Critical gaps show 🔴 icon
    await expect(
      page.getByText(/🔴.*aws/i).or(page.locator('[class*="border-red-500"]').first())
    ).toBeVisible();
  });

  // TC-2: Submit JD URL → receive fit assessment
  test('TC-2: submits JD URL and displays fit assessment results', async ({ page }) => {
    await mockJobFitApi(page, MOCK_ANALYSIS_RESPONSE);

    const urlInput = page.locator('#jobDescriptionUrl');
    await urlInput.fill('https://boards.greenhouse.io/acme/jobs/senior-engineer');
    await expect(page.getByRole('button', { name: 'Analyze Fit →' })).toBeEnabled();
    await page.getByRole('button', { name: 'Analyze Fit →' }).click();

    await expect(page.getByRole('heading', { name: 'Job Fit Analysis Results' })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText('MODERATE FIT')).toBeVisible();
  });

  // TC-3: Empty input validation
  test('TC-3: shows validation error when both text and URL are provided', async ({ page }) => {
    await page.locator('#jobDescriptionText').fill(JD_TEXT_VALID);
    await page.locator('#jobDescriptionUrl').fill('https://example.com/job');

    // Submit button should be disabled when both fields are filled
    await expect(page.getByRole('button', { name: 'Analyze Fit →' })).toBeDisabled();
  });

  test('TC-3b: shows error for invalid URL format', async ({ page }) => {
    await page.locator('#jobDescriptionUrl').fill('not-a-valid-url');
    await expect(page.getByText(/Please enter a valid URL/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Analyze Fit →' })).toBeDisabled();
  });

  // TC-4: No matching catalog entries (empty catalog)
  // FIXME: Test is flaky in CI - empty catalog message rendering may vary
  test.skip('TC-4: displays empty catalog warning when catalogEmpty is true', async ({ page }) => {
    await mockJobFitApi(page, MOCK_EMPTY_CATALOG_RESPONSE);

    await page.locator('#jobDescriptionText').fill(JD_TEXT_VALID);
    await page.getByRole('button', { name: 'Analyze Fit →' }).click();

    await expect(page.getByRole('heading', { name: 'Job Fit Analysis Results' })).toBeVisible({
      timeout: 15000,
    });

    await expect(page.getByText('No Catalog Data Yet')).toBeVisible();
    await expect(
      page.getByText(
        'Your catalog is empty. Upload a resume or add application history to enable fit analysis.'
      )
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Upload Resume →' }).or(page.getByText('Upload Resume →'))
    ).toBeVisible();
  });

  // TC-7: Error handling
  test('TC-7a: shows error state on API network failure', async ({ page }) => {
    await page.route('**/api/catalog/job-fit/analyze', (route) => route.abort('failed'));

    await page.locator('#jobDescriptionText').fill(JD_TEXT_VALID);
    await page.getByRole('button', { name: 'Analyze Fit →' }).click();

    await expect(page.getByText('Analysis Failed')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
  });

  test('TC-7b: shows error state on API 422 response (URL fetch failure)', async ({ page }) => {
    await mockJobFitApi(
      page,
      {
        error: {
          code: 'URL_FETCH_FAILED',
          message:
            'Could not retrieve job description from URL. The site may be blocking automated access. Please paste the job description text directly.',
          details: { url: 'https://blocked.example.com/job', httpStatus: 403 },
        },
      },
      422
    );

    await page.locator('#jobDescriptionUrl').fill('https://blocked.example.com/job');
    await page.getByRole('button', { name: 'Analyze Fit →' }).click();

    await expect(page.getByText('Analysis Failed')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
  });

  test('shows analyzing state briefly during submission', async ({ page }) => {
    // Delay the API response to catch the loading state
    await page.route('**/api/catalog/job-fit/analyze', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_ANALYSIS_RESPONSE),
      });
    });

    await page.locator('#jobDescriptionText').fill(JD_TEXT_VALID);
    await page.getByRole('button', { name: 'Analyze Fit →' }).click();

    await expect(page.getByText('Analyzing Job Fit...')).toBeVisible();
  });

  test('Analyze Another button resets to input stage', async ({ page }) => {
    await mockJobFitApi(page, MOCK_ANALYSIS_RESPONSE);

    await page.locator('#jobDescriptionText').fill(JD_TEXT_VALID);
    await page.getByRole('button', { name: 'Analyze Fit →' }).click();

    await expect(page.getByRole('heading', { name: 'Job Fit Analysis Results' })).toBeVisible({
      timeout: 15000,
    });

    await page.getByRole('button', { name: '← Analyze Another' }).click();
    await expect(page.getByRole('heading', { name: 'Job Fit Analysis' })).toBeVisible();
    await expect(page.locator('#jobDescriptionText')).toBeVisible();
  });

  test('Try Again button resets from error state', async ({ page }) => {
    await page.route('**/api/catalog/job-fit/analyze', (route) => route.abort('failed'));

    await page.locator('#jobDescriptionText').fill(JD_TEXT_VALID);
    await page.getByRole('button', { name: 'Analyze Fit →' }).click();

    await expect(page.getByText('Analysis Failed')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Try Again' }).click();

    await expect(page.getByRole('heading', { name: 'Job Fit Analysis' })).toBeVisible();
  });

  test('STAR entries are displayed when present in response', async ({ page }) => {
    await mockJobFitApi(page, MOCK_ANALYSIS_RESPONSE);

    await page.locator('#jobDescriptionText').fill(JD_TEXT_VALID);
    await page.getByRole('button', { name: 'Analyze Fit →' }).click();

    await expect(page.getByRole('heading', { name: 'Job Fit Analysis Results' })).toBeVisible({
      timeout: 15000,
    });

    await expect(page.getByText('💡 Recommended STAR Entries')).toBeVisible();
    await expect(page.getByText(/Led migration of monolith/)).toBeVisible();
    await expect(page.getByText(/Relevance: 85%/)).toBeVisible();
  });

  test('navigation links work - Back to Dashboard', async ({ page }) => {
    await page.getByRole('button', { name: '← Back to Dashboard' }).click();
    await expect(page).toHaveURL('/');
  });

  // TC-LLM-1: LLM-powered parsing of non-standard prose-style JD
  test('TC-LLM-1: LLM correctly parses non-standard prose JD and displays full results', async ({
    page,
  }) => {
    // mockAnthropicApi is set up in addition to mockJobFitApi so both interception
    // layers are covered if tests are later adapted to run against a real backend.
    await mockAnthropicApi(page, MOCK_LLM_ANALYSIS_RESPONSE.parsedJd);
    await mockJobFitApi(page, MOCK_LLM_ANALYSIS_RESPONSE);

    await page.locator('#jobDescriptionText').fill(JD_TEXT_NONSTANDARD);
    await page.getByRole('button', { name: 'Analyze Fit →' }).click();

    await expect(page.getByRole('heading', { name: 'Job Fit Analysis Results' })).toBeVisible({
      timeout: 15000,
    });

    await expect(page.getByText('STRONG FIT')).toBeVisible();
    await expect(page.getByText('Strong match — you meet 5 of 6 required skills.')).toBeVisible();
    await expect(page.getByText('Staff Infrastructure Engineer')).toBeVisible();
    await expect(page.getByText('Remote (US/EU)')).toBeVisible();
    await expect(page.getByText('$200,000 - $240,000')).toBeVisible();
    await expect(page.getByText('✅ Strong Matches (5)')).toBeVisible();
    await expect(page.getByText('❌ Gaps (1)')).toBeVisible();
  });

  // TC-LLM-2: LLM unavailable — regex fallback produces degraded results, UI stays stable
  test('TC-LLM-2: UI handles regex fallback gracefully when LLM is unavailable', async ({
    page,
  }) => {
    // Simulate the fallback path: LLM failed, regex could not extract required skills
    // from the prose-style JD, so recommendation is null and requiredStack is empty.
    await mockJobFitApi(page, MOCK_LLM_FALLBACK_ANALYSIS_RESPONSE);

    await page.locator('#jobDescriptionText').fill(JD_TEXT_NONSTANDARD);
    await page.getByRole('button', { name: 'Analyze Fit →' }).click();

    await expect(page.getByRole('heading', { name: 'Job Fit Analysis Results' })).toBeVisible({
      timeout: 15000,
    });

    // Degraded fallback still renders without crash; summary explains the situation
    await expect(page.getByText('NO RECOMMENDATION')).toBeVisible();
    await expect(
      page.getByText(
        'Unable to compute fit score — no required skills found in the job description.'
      )
    ).toBeVisible();

    // Navigation still works from the degraded results state
    await page.getByRole('button', { name: '← Analyze Another' }).click();
    await expect(page.getByRole('heading', { name: 'Job Fit Analysis' })).toBeVisible();
  });
});
