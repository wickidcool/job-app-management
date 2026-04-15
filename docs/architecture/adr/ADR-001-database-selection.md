# ADR-001: Database Selection

## Status

**Accepted** (2026-04-15)

## Context

The Job Application Manager requires persistent storage for user application tracking data. The requirements document ([WIC-15](/WIC/issues/WIC-15)) identified this as an open technical question:

> **Database:** SQLite (simpler, local-first) or PostgreSQL (scalable, cloud-ready)?

Additional context from requirements:
- MVP scope: ~1,000 active users, ~10,000 applications
- Core operations: CRUD on applications, status transitions, dashboard aggregations
- Future features: reminders, notes, contacts
- Existing tech: React frontend, considering Node.js backend

The task description ([WIC-17](/WIC/issues/WIC-17)) specified AWS CDK infrastructure with Lambda, API Gateway, and DynamoDB.

## Decision Drivers

1. **Serverless compatibility**: Must work well with AWS Lambda (connection management)
2. **Cost efficiency**: Minimize costs for variable/low traffic patterns
3. **Operational simplicity**: Reduce infrastructure management burden
4. **Performance**: Sub-100ms response times for dashboard views
5. **Scalability**: Support growth without re-architecture
6. **Developer experience**: Type-safe, easy to work with from TypeScript

## Options Considered

### Option A: SQLite (Local-First)

**Description**: Embedded database stored on local filesystem.

**Pros**:
- Zero configuration
- No network latency
- Works offline
- Simple development

**Cons**:
- Not compatible with serverless (Lambda has ephemeral filesystems)
- No multi-device sync without additional infrastructure
- Backup/restore complexity
- Single-user per device model

**Assessment**: Rejected. Incompatible with serverless architecture.

### Option B: PostgreSQL (RDS)

**Description**: Managed relational database via Amazon RDS.

**Pros**:
- Rich query capabilities
- ACID transactions
- Familiar SQL model
- Strong ecosystem (ORMs, migrations)

**Cons**:
- Connection pooling issues with Lambda (requires RDS Proxy)
- Always-on costs (~$15-50/month minimum)
- Cold start impact from connection establishment
- Schema migrations required for changes

**Assessment**: Viable but more complex and costly for MVP.

### Option C: DynamoDB (Serverless NoSQL)

**Description**: Fully managed NoSQL database with on-demand pricing.

**Pros**:
- True serverless (no connection management)
- On-demand pricing (pay per request)
- Single-digit millisecond latency
- Auto-scaling built in
- Native AWS integration (IAM, Lambda, CDK)
- No cold start connection overhead

**Cons**:
- Learning curve for single-table design
- Less flexible querying (must design for access patterns)
- No joins (denormalization required)
- Transactions limited to 25 items

**Assessment**: Best fit for serverless MVP.

### Option D: Serverless PostgreSQL (Aurora Serverless v2, Neon)

**Description**: PostgreSQL with serverless scaling.

**Pros**:
- SQL flexibility
- Scales to zero (Aurora Serverless v2 doesn't fully)
- Familiar model

**Cons**:
- Aurora Serverless v2: higher minimum cost, doesn't scale to zero
- Neon: third-party, additional vendor relationship
- Still has connection overhead vs native DynamoDB

**Assessment**: Over-engineered for MVP, consider for Phase 2+ if needed.

## Decision

**Adopt DynamoDB with single-table design.**

### Rationale

1. **Native serverless**: DynamoDB is purpose-built for Lambda workloads with no connection management overhead.

2. **Cost model**: On-demand pricing means we pay ~$0 during development and scale costs linearly with usage. For 100,000 reads + 10,000 writes/month, cost is under $2.

3. **Performance**: Single-digit millisecond latency meets dashboard performance requirements without caching layer.

4. **Access patterns are known**: The requirements clearly define our access patterns:
   - List applications by user
   - Filter by status
   - Get single application with history
   - Dashboard aggregations
   
   These patterns map well to DynamoDB's key-based access.

5. **AWS CDK integration**: First-class CDK constructs with type-safe definitions.

6. **Future-proof**: DynamoDB handles millions of requests per second if we grow.

### Trade-offs Accepted

- **Learning curve**: Team needs to understand single-table design patterns
- **Query flexibility**: Complex ad-hoc queries require application-side filtering
- **Denormalization**: Status history stored alongside applications

### Migration Path

If we later need SQL capabilities (complex reporting, ad-hoc queries), we can:
1. Add DynamoDB Streams → Lambda → PostgreSQL for analytics
2. Use Amazon Athena for S3-exported data analysis
3. Migrate to Aurora Serverless v2 with data export/import

## Consequences

### Positive

- Zero connection management code
- Near-zero cost during development
- Sub-10ms API responses without caching
- Automatic scaling and backup
- Infrastructure-as-code via CDK

### Negative

- Must design access patterns upfront
- Complex queries require multiple requests or filtering in Lambda
- Team learning investment for DynamoDB patterns

### Neutral

- TypeScript types will model DynamoDB entities
- Point-in-time recovery provides backup strategy

## Implementation Notes

See [DATA_MODEL.md](../DATA_MODEL.md) for the single-table design implementing this decision.

Key entities:
- `APPLICATION`: Core application records
- `STATUS_HISTORY`: Transition audit trail
- `USER_STATS`: Pre-aggregated dashboard statistics

## References

- [AWS DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [The DynamoDB Book](https://www.dynamodbbook.com/) by Alex DeBrie
- [Single-Table Design with DynamoDB](https://www.alexdebrie.com/posts/dynamodb-single-table/)
- [Requirements Plan (WIC-15)](/WIC/issues/WIC-15#document-plan)
