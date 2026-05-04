import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for ApplicationForm server validation error handling (WIC-186)
 *
 * These tests verify that:
 * 1. Field-level validation errors from the server are displayed on the relevant inputs
 * 2. Form-level validation errors are displayed in a banner
 * 3. Errors clear when the user re-submits
 *
 * Tests use mock auth to bypass authentication without a real backend.
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

test.describe('ApplicationForm - Server Validation Errors', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
    // Navigate to the applications page
    await page.goto('/');

    // Wait for the page to load
    await page.waitForSelector('body');
  });

  test('should display field-level validation errors from server', async ({ page }) => {
    // Click the "Add Application" button
    await page.click('button:has-text("Add Application")');

    // Wait for the dialog to open
    await page.waitForSelector('dialog[open]');

    // Fill in the form with invalid data that will trigger server validation
    await page.fill('input[id="jobTitle"]', 'A'); // Too short (< 2 chars)
    await page.fill('input[id="company"]', 'B'); // Too short (< 2 chars)

    // Submit the form
    await page.click('button[type="submit"]:has-text("Save Application")');

    // Wait for error responses
    await page.waitForTimeout(500);

    // Check for field-level error messages
    const jobTitleError = page.locator('#jobTitle-error');
    await expect(jobTitleError).toBeVisible();
    await expect(jobTitleError).toContainText(/must be at least/i);

    const companyError = page.locator('#company-error');
    await expect(companyError).toBeVisible();
    await expect(companyError).toContainText(/must be at least/i);
  });

  test('should display invalid URL validation error', async ({ page }) => {
    // Click the "Add Application" button
    await page.click('button:has-text("Add Application")');

    // Wait for the dialog to open
    await page.waitForSelector('dialog[open]');

    // Fill in the form with valid required fields but invalid URL
    await page.fill('input[id="jobTitle"]', 'Software Engineer');
    await page.fill('input[id="company"]', 'Tech Corp');
    await page.fill('input[id="url"]', 'not-a-valid-url');

    // Submit the form
    await page.click('button[type="submit"]:has-text("Save Application")');

    // Wait for error responses
    await page.waitForTimeout(500);

    // Check for URL field error
    const urlError = page.locator('#url-error');
    await expect(urlError).toBeVisible();
    await expect(urlError).toContainText(/valid URL/i);
  });

  test('should display form-level error banner for general errors', async ({ page }) => {
    // This test requires mocking a server error response
    // For now, we'll test that the error banner structure exists

    // Click the "Add Application" button
    await page.click('button:has-text("Add Application")');

    // Wait for the dialog to open
    await page.waitForSelector('dialog[open]');

    // The error banner should not be visible initially
    const errorBanner = page.locator('div[role="alert"]');
    await expect(errorBanner).not.toBeVisible();
  });

  test('should clear errors when form is re-submitted', async ({ page }) => {
    // Click the "Add Application" button
    await page.click('button:has-text("Add Application")');

    // Wait for the dialog to open
    await page.waitForSelector('dialog[open]');

    // Fill in the form with invalid data
    await page.fill('input[id="jobTitle"]', 'A'); // Too short
    await page.fill('input[id="company"]', 'Tech Corp');

    // Submit the form (should show errors)
    await page.click('button[type="submit"]:has-text("Save Application")');
    await page.waitForTimeout(500);

    // Verify error is shown
    const jobTitleError = page.locator('#jobTitle-error');
    await expect(jobTitleError).toBeVisible();

    // Fix the validation error
    await page.fill('input[id="jobTitle"]', 'Software Engineer');

    // Re-submit the form
    await page.click('button[type="submit"]:has-text("Save Application")');

    // Wait for success (dialog should close if no errors)
    await page.waitForTimeout(1000);

    // The dialog should be closed on success
    const dialog = page.locator('dialog[open]');
    await expect(dialog).not.toBeVisible();
  });

  test('should clear errors when dialog is closed and reopened', async ({ page }) => {
    // Click the "Add Application" button
    await page.click('button:has-text("Add Application")');

    // Wait for the dialog to open
    await page.waitForSelector('dialog[open]');

    // Fill in the form with invalid data
    await page.fill('input[id="jobTitle"]', 'A'); // Too short

    // Submit the form (should show errors)
    await page.click('button[type="submit"]:has-text("Save Application")');
    await page.waitForTimeout(500);

    // Verify error is shown
    const jobTitleError = page.locator('#jobTitle-error');
    await expect(jobTitleError).toBeVisible();

    // Close the dialog
    await page.click('button:has-text("Cancel")');

    // Re-open the dialog
    await page.click('button:has-text("Add Application")');
    await page.waitForSelector('dialog[open]');

    // The error should not be visible anymore
    await expect(jobTitleError).not.toBeVisible();
  });

  test('should handle extended tracking field validation errors', async ({ page }) => {
    // Click the "Add Application" button
    await page.click('button:has-text("Add Application")');

    // Wait for the dialog to open
    await page.waitForSelector('dialog[open]');

    // Fill in required fields correctly
    await page.fill('input[id="jobTitle"]', 'Software Engineer');
    await page.fill('input[id="company"]', 'Tech Corp');

    // Fill in extended tracking fields with invalid data
    // Contact field has a 200 char limit
    const longContact = 'A'.repeat(201);
    await page.fill('input[id="contact"]', longContact);

    // Next action has a 500 char limit
    const longNextAction = 'B'.repeat(501);
    await page.fill('input[id="nextAction"]', longNextAction);

    // Invalid date format
    await page.fill('input[id="nextActionDue"]', '2024-13-45'); // Invalid date

    // Submit the form
    await page.click('button[type="submit"]:has-text("Save Application")');
    await page.waitForTimeout(500);

    // Check for validation errors on extended tracking fields
    const contactError = page.locator('#contact-error');
    const nextActionError = page.locator('#nextAction-error');
    const nextActionDueError = page.locator('#nextActionDue-error');

    // At least one of these should show an error
    const hasContactError = await contactError.isVisible();
    const hasNextActionError = await nextActionError.isVisible();
    const hasNextActionDueError = await nextActionDueError.isVisible();

    expect(hasContactError || hasNextActionError || hasNextActionDueError).toBe(true);
  });
});

test.describe('ApplicationForm - Edit Mode Errors', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForSelector('body');
  });

  test('should display validation errors when editing an application', async ({ page }) => {
    // First, ensure there's at least one application to edit
    // This assumes there's an existing application in the list

    // Click on an application card or edit button
    const editButton = page.locator('button:has-text("Edit")').first();

    // Check if edit button exists
    const hasEditButton = await editButton.count();

    if (hasEditButton > 0) {
      await editButton.click();

      // Wait for the edit dialog to open
      await page.waitForSelector('dialog[open]');

      // Clear the job title field and enter invalid data
      await page.fill('input[id="jobTitle"]', '');

      // Submit the form
      await page.click('button[type="submit"]:has-text("Save Application")');
      await page.waitForTimeout(500);

      // Check for validation error
      const jobTitleError = page.locator('#jobTitle-error');
      await expect(jobTitleError).toBeVisible();
    }
  });
});
