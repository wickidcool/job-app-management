# ADR-003: Job Fit API Design

## Status

**Accepted** (2026-04-25)

## Context

UC-3 (Job Description Fit Analysis) requires an API endpoint for submitting job descriptions and receiving fit assessments. The feature needs to support two input methods:
1. Direct text input (user pastes JD content)
2. URL input (system fetches JD from job board)

The original issue description proposed two endpoints:
- `POST /catalog/job-fit/analyze` for text input
- `POST /catalog/job-fit/analyze-url` for URL input

We need to decide whether to use two separate endpoints or a single unified endpoint.

## Decision Drivers

1. **API simplicity**: Fewer endpoints are easier to document and maintain
2. **Client ergonomics**: Frontend should have a simple interface
3. **Error handling consistency**: Similar operations should have consistent error responses
4. **Rate limiting**: URL fetches are more expensive and should be rate-limited differently
5. **Future extensibility**: May need to add file upload or other input methods

## Options Considered

### Option A: Two Separate Endpoints

```
POST /catalog/job-fit/analyze      — text input
POST /catalog/job-fit/analyze-url  — URL input
```

**Pros**:
- Clear separation of concerns
- Each endpoint has focused request schema
- Simpler per-endpoint validation

**Cons**:
- Duplicated response schema documentation
- Frontend must choose which endpoint to call
- Adding new input methods requires new endpoints

### Option B: Single Unified Endpoint with Mutually Exclusive Inputs

```
POST /catalog/job-fit/analyze
{
  "jobDescriptionText": "...",   // XOR
  "jobDescriptionUrl": "..."
}
```

**Pros**:
- Single endpoint to document and maintain
- Response schema defined once
- Frontend uses same endpoint regardless of input method
- Easy to extend with new input fields (e.g., `jobDescriptionFile`)
- Rate limiting can be differentiated based on which field is provided

**Cons**:
- Request validation is more complex (mutual exclusion)
- Slightly larger request schema

## Decision

**Adopt Option B: Single unified endpoint with mutually exclusive inputs.**

The endpoint `POST /catalog/job-fit/analyze` accepts exactly one of:
- `jobDescriptionText` (string, 50-50,000 chars)
- `jobDescriptionUrl` (valid URL)

Validation returns `JD_INPUT_REQUIRED` if neither provided, `JD_INPUT_CONFLICT` if both provided.

### Rationale

1. **Simpler API surface**: One endpoint is easier to understand and integrate.

2. **Consistent response handling**: Frontend always processes the same response type regardless of how the JD was submitted.

3. **Extensibility**: Adding file upload later only requires adding a `jobDescriptionFile` field to the existing endpoint.

4. **Differentiated rate limiting**: The endpoint can inspect which input field is present and apply the appropriate rate limit (30/min for text, 10/min for URL).

5. **Precedent**: Similar to how `POST /catalog/generate-diff` accepts different source types in a single endpoint.

### Trade-offs Accepted

- Request validation must enforce mutual exclusion between input fields
- Zod schema is slightly more complex with `refine()` for XOR validation

## Consequences

### Positive

- Single endpoint to maintain and version
- Response types are reusable across input methods
- Clear path to add file upload input method

### Negative

- Zod validation schema requires custom refinement
- OpenAPI spec must document mutual exclusion constraint clearly

### Neutral

- Rate limiting logic moved from route-level to handler-level (inspect which field is present)

## References

- [API_CONTRACTS.md — Job Fit Analysis](../API_CONTRACTS.md#job-fit-analysis-uc-3)
- [WIC-113 User Story](../../design/USER_FLOWS.md)
