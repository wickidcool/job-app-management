# Job Application Manager — Architecture Overview

## Executive Summary

This document describes the serverless backend architecture for the Job Application Manager, designed to integrate with the existing React/Vite frontend. The architecture uses AWS CDK for infrastructure-as-code, providing a scalable, cost-effective solution for tracking job applications.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Frontend (React/Vite)                          │
│                          Static hosting on CloudFront/S3                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ HTTPS
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Amazon API Gateway                                │
│                           (REST API with CORS)                               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐│
│  │ /applications│ │ /applications│ │/cover-letters│ │ /dashboard             ││
│  │   CRUD      │ │ /{id}/status │ │   (read)    │ │   (aggregations)       ││
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                           ┌───────────┼───────────┐
                           │           │           │
                           ▼           ▼           ▼
              ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
              │ Applications   │ │ Status         │ │ Dashboard      │
              │ Lambda         │ │ Lambda         │ │ Lambda         │
              │ (CRUD ops)     │ │ (transitions)  │ │ (aggregations) │
              └────────────────┘ └────────────────┘ └────────────────┘
                           │           │           │
                           └───────────┼───────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Amazon DynamoDB                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    ApplicationsTable (Single-Table Design)              ││
│  │  PK: USER#{userId}                                                      ││
│  │  SK: APP#{applicationId} | STATUS#{status}#APP#{id} | STATS             ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Frontend** | React 18, TypeScript, Vite | Existing scaffold |
| **API** | Amazon API Gateway (REST) | Managed, scalable, integrated auth |
| **Compute** | AWS Lambda (Node.js 20) | Serverless, pay-per-use, TypeScript support |
| **Database** | Amazon DynamoDB | Serverless, single-digit ms latency, flexible schema |
| **Auth** | Amazon Cognito | Managed user pools, OAuth2/OIDC support |
| **IaC** | AWS CDK (TypeScript) | Type-safe infrastructure, same language as app |
| **Hosting** | CloudFront + S3 | Global CDN, low latency for static assets |

## Design Decisions

### Why Serverless?

1. **Cost-effective**: Pay only for actual usage; ideal for variable workloads
2. **Scalable**: Automatic scaling from 0 to millions of requests
3. **Operational**: No servers to manage, patch, or monitor
4. **Fast iteration**: Deploy new features without infrastructure changes

### Why DynamoDB over RDS/PostgreSQL?

1. **Serverless model**: No connection pooling issues with Lambda
2. **Performance**: Single-digit millisecond latency at any scale
3. **Cost**: Pay-per-request pricing for unpredictable workloads
4. **Simplicity**: No schema migrations for MVP iteration
5. **Single-table design**: Efficient access patterns with minimal queries

See [ADR-001: Database Selection](./adr/ADR-001-database-selection.md) for full analysis.

### Why Cognito for Auth?

1. **Integrated**: Native integration with API Gateway
2. **Standards-based**: OAuth 2.0 / OpenID Connect
3. **Features**: Email verification, password policies, MFA
4. **Cost**: Free tier covers 50,000 MAU

## Component Details

### API Gateway

- **Type**: REST API (not HTTP API) for request validation and usage plans
- **Authorization**: Cognito User Pool Authorizer
- **CORS**: Configured for frontend domain
- **Throttling**: 1000 requests/second default, burst 2000

### Lambda Functions

| Function | Purpose | Memory | Timeout |
|----------|---------|--------|---------|
| `ApplicationsHandler` | CRUD operations on applications | 256 MB | 10s |
| `StatusHandler` | Status transitions with validation | 256 MB | 10s |
| `DashboardHandler` | Aggregation queries for stats | 512 MB | 15s |

**Runtime**: Node.js 20.x with ESM modules
**Bundling**: esbuild via CDK's NodejsFunction construct

### DynamoDB Table

**Table Name**: `JobApplicationManager-Applications`

**Capacity Mode**: On-demand (pay-per-request)

**Key Schema**:
- Partition Key (PK): `String`
- Sort Key (SK): `String`

**Global Secondary Index (GSI1)**:
- GSI1PK: `String`
- GSI1SK: `String`
- Purpose: Query applications by status across users (admin) or by date

See [DATA_MODEL.md](./DATA_MODEL.md) for entity definitions and access patterns.

## Security

### Authentication Flow

```
┌─────────┐     ┌─────────┐     ┌──────────┐     ┌─────────┐
│ Frontend│────▶│ Cognito │────▶│API Gateway│────▶│ Lambda  │
│         │     │  Login  │     │ Authorizer│     │         │
└─────────┘     └─────────┘     └──────────┘     └─────────┘
     │               │                │               │
     │  1. Login     │                │               │
     │──────────────▶│                │               │
     │               │                │               │
     │  2. JWT Token │                │               │
     │◀──────────────│                │               │
     │               │                │               │
     │  3. API Request + Bearer Token │               │
     │───────────────────────────────▶│               │
     │               │                │               │
     │               │  4. Validate   │               │
     │               │◀───────────────│               │
     │               │                │               │
     │               │  5. Claims     │               │
     │               │───────────────▶│               │
     │               │                │  6. Execute   │
     │               │                │──────────────▶│
```

### Security Controls

| Control | Implementation |
|---------|----------------|
| **Transport** | TLS 1.2+ enforced |
| **Authentication** | JWT tokens via Cognito |
| **Authorization** | User ID extracted from JWT claims |
| **Data isolation** | Partition key includes user ID |
| **Input validation** | API Gateway request validators |
| **Rate limiting** | API Gateway throttling |

## Deployment Architecture

### Environments

| Environment | Purpose | Domain |
|-------------|---------|--------|
| `dev` | Development/testing | `dev.jobapp.example.com` |
| `staging` | Pre-production validation | `staging.jobapp.example.com` |
| `prod` | Production | `app.jobapp.example.com` |

### CI/CD Pipeline

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│  Push   │────▶│  Build  │────▶│  Test   │────▶│ Deploy  │
│ to main │     │  & Lint │     │  Suite  │     │  (CDK)  │
└─────────┘     └─────────┘     └─────────┘     └─────────┘
```

1. **Build**: TypeScript compilation, Lambda bundling
2. **Test**: Unit tests, integration tests with local DynamoDB
3. **Deploy**: `cdk deploy` to target environment

### CDK Stack Structure

```
lib/
├── job-app-manager-stack.ts    # Main stack
├── constructs/
│   ├── api.ts                  # API Gateway + Lambda
│   ├── database.ts             # DynamoDB table
│   ├── auth.ts                 # Cognito resources
│   └── frontend.ts             # CloudFront + S3
└── lambda/
    ├── applications/           # CRUD handlers
    ├── status/                 # Status transition handler
    └── dashboard/              # Aggregation handler
```

## Cost Estimation (Monthly)

Assuming 1,000 active users, 10,000 applications, 100,000 API requests/month:

| Service | Estimated Cost |
|---------|---------------|
| API Gateway | $3.50 |
| Lambda | $0.50 |
| DynamoDB | $2.00 |
| Cognito | $0.00 (free tier) |
| CloudFront + S3 | $1.00 |
| **Total** | **~$7/month** |

## Monitoring & Observability

| Aspect | Tool |
|--------|------|
| **Logs** | CloudWatch Logs (Lambda) |
| **Metrics** | CloudWatch Metrics (API Gateway, Lambda, DynamoDB) |
| **Tracing** | AWS X-Ray |
| **Alarms** | CloudWatch Alarms (error rate, latency) |

### Key Metrics to Monitor

- API Gateway: 4xx/5xx error rates, latency p50/p99
- Lambda: Duration, errors, throttles, concurrent executions
- DynamoDB: Consumed capacity, throttled requests, latency

## Future Considerations

### Phase 2+ Features

| Feature | Architecture Impact |
|---------|-------------------|
| **Reminders (US-7.1)** | EventBridge scheduled rules + SNS/SES |
| **Notes (US-8.1)** | Additional DynamoDB entity |
| **Contacts (US-8.2)** | Additional DynamoDB entity |
| **Multi-device sync** | Already supported via cloud-first design |

### Scaling Considerations

- DynamoDB auto-scales with on-demand mode
- Lambda concurrent execution limits (default 1000)
- Consider provisioned concurrency for consistent latency at scale

## References

- [API Contracts](./API_CONTRACTS.md)
- [Data Model](./DATA_MODEL.md)
- [ADR-001: Database Selection](./adr/ADR-001-database-selection.md)
- [Requirements Plan (WIC-15)](/WIC/issues/WIC-15#document-plan)
- [UI/UX Design Specs](../design/)
