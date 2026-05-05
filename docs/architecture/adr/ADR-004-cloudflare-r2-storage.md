# ADR-004: Cloudflare R2 Document Storage

## Status

Accepted

## Context

The application stores user documents (resumes, cover letters, exports) that need to:
- Be isolated per user in multi-user mode
- Support cloud deployment without local filesystem
- Provide secure access via time-limited URLs
- Work with local development (MinIO or filesystem fallback)

Options considered:
1. **Local filesystem** - Current approach, doesn't work in serverless
2. **AWS S3** - Industry standard, egress fees
3. **Cloudflare R2** - S3-compatible, zero egress fees, integrates with Pages
4. **Supabase Storage** - Part of Supabase ecosystem

## Decision

Use **Cloudflare R2** for production document storage with S3-compatible API.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Client                                      │
│                                                                          │
│  Upload: POST /api/resumes ──────┐                                      │
│                                   │                                      │
│  Download: GET signed URL ◀───────│───────────────────────────┐         │
│                                   │                           │         │
└───────────────────────────────────│───────────────────────────│─────────┘
                                    │                           │
                                    ▼                           │
┌─────────────────────────────────────────────────────────────────────────┐
│                              Backend                                     │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │                   Storage Service                               │     │
│  │                                                                  │     │
│  │  uploadObject(key, body, contentType)                           │     │
│  │  deleteObject(key)                                              │     │
│  │  getSignedUrl(key, expiresIn) ─────────────────────────────────│─────┘
│  │                                                                  │
│  │  Key format: {userId}/{type}/{filename}                         │
│  │  Example: abc123/resumes/resume-v2.pdf                          │
│  └────────────────────────────────────────────────────────────────┘
│                                    │
│                                    │ AWS SDK S3Client
│                                    ▼
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Cloudflare R2 Bucket                             │
│                                                                          │
│  jobapp-documents/                                                       │
│  ├── {user-uuid-1}/                                                      │
│  │   ├── resumes/                                                        │
│  │   │   ├── resume-2024.pdf                                            │
│  │   │   └── resume-tech.pdf                                            │
│  │   └── resume-exports/                                                 │
│  │       └── 01HXYZ.md                                                  │
│  ├── {user-uuid-2}/                                                      │
│  │   └── resumes/                                                        │
│  │       └── cv.pdf                                                      │
│  └── anon/                          # Local dev without auth             │
│      └── resumes/                                                        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Implementation Details

**Storage Service** (`packages/api/src/services/storage.service.ts`):
- Uses `@aws-sdk/client-s3` for R2 compatibility
- Signed URLs via `@aws-sdk/s3-request-presigner`
- Lazy client initialization for serverless cold starts
- `forcePathStyle: true` for MinIO compatibility in local dev

**Object Key Convention**:
```
{userId}/{type}/{filename}
```
- `userId`: Supabase auth UUID, or `anon` for unauthenticated local dev
- `type`: `resumes`, `resume-exports`, `cover-letters`
- `filename`: Original or generated filename

**Signed URL Security**:
- Default expiry: 1 hour
- Generated on-demand per request
- No public bucket access
- User isolation enforced at key generation (userId prefix)

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `R2_ENDPOINT` | Production | R2 API endpoint URL |
| `R2_ACCESS_KEY_ID` | Production | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | Production | R2 API token secret |
| `R2_BUCKET` | Production | Bucket name (e.g., `jobapp-documents`) |

**Local Development**: When R2 variables are not set, `isR2Configured()` returns false and the service falls back to local filesystem storage.

### API Changes

Resume upload response includes storage location:
```json
{
  "id": "01HXY...",
  "fileName": "resume.pdf",
  "filePath": "abc123/resumes/resume.pdf",
  "downloadUrl": "https://...signed-url..."
}
```

Download flow:
1. Client requests resume metadata: `GET /api/resumes/{id}`
2. Server generates signed URL for `filePath`
3. Client fetches directly from R2 signed URL

## Consequences

### Positive

- **Zero egress fees**: R2 has no bandwidth charges
- **S3 compatibility**: Standard SDK, easy migration
- **Global edge**: Documents served from Cloudflare edge
- **User isolation**: Path-based isolation at storage level
- **Serverless-ready**: No local filesystem dependency

### Negative

- **Cloudflare lock-in**: R2-specific (but S3-compatible for portability)
- **Signed URL overhead**: Extra request to get download URL
- **No direct browser upload**: Files go through backend (size limits)

### Migration Path

Local filesystem to R2:
1. Deploy R2 bucket
2. Configure environment variables
3. Migrate existing files: `aws s3 sync ./data/resumes s3://bucket/anon/resumes`
4. Update database `file_path` column to R2 keys

## References

- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [AWS SDK S3 Client](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/)
- WIC-198: R2 storage implementation
- ADR-003: Multi-user authentication (user_id source)
