# QA Testing Guide: WIC-186 - Server Validation Errors in ApplicationForm

## Overview

This guide provides comprehensive testing instructions for the server validation error handling feature in the ApplicationForm component.

**Issue:** WIC-186  
**Feature:** Display server validation errors to users  
**Components:** `packages/web/src/components/ApplicationForm.tsx`

## Prerequisites

Before testing, ensure:

1. ✅ Database is running (PostgreSQL)
2. ✅ Database migration 0007 (UC-5 extended fields) has been applied
3. ✅ API server is running on `http://localhost:3000`
4. ✅ Web dev server is running on `http://localhost:5173`

### Setup Commands

```bash
# Start database
docker compose up -d

# Run migrations
npm run db:migrate

# Start API server
npm run dev:api

# Start web dev server (in separate terminal)
npm run dev
```

## Test Scenarios

### 1. Field-Level Validation Errors

#### Test Case 1.1: Job Title Validation
**Steps:**
1. Navigate to http://localhost:5173
2. Click "Add Application" button
3. Enter `A` in the Job Title field (too short, < 2 chars)
4. Enter `Test Company` in the Company field
5. Click "Save Application"

**Expected Result:**
- ❌ Form does NOT close
- ✅ Error message appears under Job Title field: "Job title must be at least 2 characters"
- ✅ Error message is styled in red text
- ✅ Input field has error styling

---

#### Test Case 1.2: Company Name Validation
**Steps:**
1. Click "Add Application" button
2. Enter `Software Engineer` in Job Title
3. Enter `X` in Company field (too short, < 2 chars)
4. Click "Save Application"

**Expected Result:**
- ❌ Form does NOT close
- ✅ Error message appears under Company field: "Company name must be at least 2 characters"

---

#### Test Case 1.3: Invalid URL Format
**Steps:**
1. Click "Add Application" button
2. Enter `Software Engineer` in Job Title
3. Enter `Tech Corp` in Company
4. Enter `not-a-url` in Job Posting URL field
5. Click "Save Application"

**Expected Result:**
- ❌ Form does NOT close
- ✅ Error message appears under URL field: "Must be a valid URL starting with http:// or https://"

---

#### Test Case 1.4: Multiple Field Errors
**Steps:**
1. Click "Add Application" button
2. Enter `A` in Job Title (invalid)
3. Enter `B` in Company (invalid)
4. Enter `bad-url` in URL (invalid)
5. Click "Save Application"

**Expected Result:**
- ❌ Form does NOT close
- ✅ ALL three error messages appear under their respective fields
- ✅ All error messages are visible simultaneously

---

### 2. Extended Tracking Field Validation

#### Test Case 2.1: Contact Field Length Limit
**Steps:**
1. Click "Add Application" button
2. Enter valid Job Title: `Software Engineer`
3. Enter valid Company: `Tech Corp`
4. Scroll to "Extended Tracking" section
5. Enter 201 characters in Contact field (exceeds 200 char limit)
6. Click "Save Application"

**Expected Result:**
- ❌ Form does NOT close
- ✅ Error message appears: "Contact must be less than 200 characters"

---

#### Test Case 2.2: Next Action Length Limit
**Steps:**
1. Fill in valid required fields
2. Enter 501 characters in Next Action field (exceeds 500 char limit)
3. Click "Save Application"

**Expected Result:**
- ✅ Error message appears: "Next action must be less than 500 characters"

---

#### Test Case 2.3: Invalid Date Format
**Steps:**
1. Fill in valid required fields
2. Manually enter invalid date in Due Date field (if possible, e.g., via dev tools)
3. Click "Save Application"

**Expected Result:**
- ✅ Error message appears: "Invalid date format"

---

### 3. Form-Level Error Banner

#### Test Case 3.1: General Server Error
**Steps:**
1. Stop the API server
2. Click "Add Application" button
3. Fill in all required fields correctly
4. Click "Save Application"

**Expected Result:**
- ✅ Red error banner appears at the top of the form
- ✅ Error banner contains text: "An error occurred while saving the application." or similar
- ✅ Banner has `role="alert"` for accessibility
- ✅ No field-level errors are shown (this is a network error, not validation)

---

#### Test Case 3.2: Validation Error without Field Mapping
**Steps:**
1. Ensure API server is running
2. Trigger a validation error that doesn't map to specific fields (if possible)

**Expected Result:**
- ✅ Error banner appears with the validation message
- ✅ Banner is styled with red background and border

---

### 4. Error Clearing Behavior

#### Test Case 4.1: Errors Clear on Re-Submit
**Steps:**
1. Click "Add Application" button
2. Enter `A` in Job Title (triggers error)
3. Click "Save Application" (error appears)
4. Fix the error by entering `Software Engineer`
5. Click "Save Application" again

**Expected Result:**
- ✅ Previous error message disappears
- ✅ Form submits successfully
- ✅ Dialog closes

---

#### Test Case 4.2: Errors Clear When Dialog Closes
**Steps:**
1. Click "Add Application" button
2. Enter `A` in Job Title (triggers error)
3. Click "Save Application" (error appears)
4. Click "Cancel" button
5. Re-open the form by clicking "Add Application" again

**Expected Result:**
- ✅ Previous error messages do NOT appear
- ✅ Form is in clean state
- ✅ Error banner is not visible

---

#### Test Case 4.3: Banner Clears on Re-Submit Attempt
**Steps:**
1. Stop API server to trigger network error
2. Fill form and click "Save Application" (banner appears)
3. Start API server
4. Click "Save Application" again (with valid data)

**Expected Result:**
- ✅ Error banner disappears before new submission
- ✅ Form submits successfully

---

### 5. Edit Mode Validation

#### Test Case 5.1: Validation Errors in Edit Mode
**Steps:**
1. Create a valid application first
2. Click "Edit" on an existing application
3. Clear the Job Title field
4. Click "Save Application"

**Expected Result:**
- ✅ Error message appears under Job Title field
- ✅ Error handling works the same as create mode

---

#### Test Case 5.2: Partial Updates with Errors
**Steps:**
1. Edit an existing application
2. Change Job Title to `A` (invalid)
3. Leave other fields valid
4. Click "Save Application"

**Expected Result:**
- ✅ Only Job Title error appears
- ✅ Other valid fields are not affected

---

### 6. Accessibility Testing

#### Test Case 6.1: Screen Reader Announcements
**Steps:**
1. Enable screen reader (NVDA, JAWS, or VoiceOver)
2. Trigger a validation error
3. Listen for announcements

**Expected Result:**
- ✅ Error messages are announced to screen reader users
- ✅ Error banner has `role="alert"` attribute
- ✅ Field errors are associated with inputs via `aria-describedby`

---

#### Test Case 6.2: Keyboard Navigation
**Steps:**
1. Trigger validation errors
2. Navigate through form using Tab key
3. Verify focus indicators on error fields

**Expected Result:**
- ✅ Focus moves to error fields
- ✅ Error messages are keyboard-accessible
- ✅ Visual focus indicators are visible

---

### 7. Edge Cases

#### Test Case 7.1: Empty Form Submission
**Steps:**
1. Click "Add Application" button
2. Click "Save Application" immediately (no data entered)

**Expected Result:**
- ✅ Multiple validation errors appear for required fields
- ✅ Both Job Title and Company show errors

---

#### Test Case 7.2: Very Long Error Messages
**Steps:**
1. Trigger a server error with a very long error message (if possible)

**Expected Result:**
- ✅ Error banner displays full message or truncates gracefully
- ✅ Banner does not break layout

---

#### Test Case 7.3: Concurrent Field Errors
**Steps:**
1. Enter invalid data in all fields simultaneously
2. Click "Save Application"

**Expected Result:**
- ✅ All field errors display without overlap
- ✅ Form remains scrollable if needed
- ✅ All errors are readable

---

## Automated Tests

Run the e2e test suite:

```bash
npm run test:e2e -- application-form-errors.spec.ts
```

**Test file:** `packages/web/e2e/application-form-errors.spec.ts`

---

## Known Limitations

1. **Database Required:** Testing requires a running PostgreSQL database with migrations applied
2. **Network Errors:** Some error scenarios require manually stopping/starting the API server
3. **Browser Testing:** Visual verification should be done in multiple browsers (Chrome, Firefox, Safari)

---

## Acceptance Criteria Checklist

- [ ] Server validation errors are visible to users
- [ ] Field-level errors show on the relevant input
- [ ] General errors show as a form-level message
- [ ] Errors clear when user re-submits
- [ ] Errors clear when dialog closes and reopens
- [ ] Error messages are accessible (screen readers, keyboard navigation)
- [ ] Extended tracking fields (UC-5) show validation errors
- [ ] Edit mode validation works correctly
- [ ] Multiple simultaneous errors display correctly

---

## Reporting Issues

If you encounter any issues during QA testing, please report them with:

1. **Test Case Number** (e.g., Test Case 1.1)
2. **Steps to Reproduce**
3. **Expected Result**
4. **Actual Result**
5. **Screenshots** (if applicable)
6. **Browser/Environment** (Chrome version, OS, etc.)

---

## Sign-Off

**QA Tester:**  
**Date:**  
**Status:** ☐ Pass ☐ Fail ☐ Pass with Notes  
**Notes:**
