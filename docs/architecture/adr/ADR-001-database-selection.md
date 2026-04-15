# ADR-001: Database Selection

## Status

**Accepted** (2026-04-15)
**Revised** (2026-04-15) — Updated for local-first requirements

## Context

The Job Application Manager requires persistent storage for user application tracking data. The requirements document ([WIC-15](/WIC/issues/WIC-15)) identified this as an open technical question:

> **Database:** SQLite (simpler, local-first) or PostgreSQL (scalable, cloud-ready)?

**Critical constraint from board (2026-04-15)**:
> "This is not a deployed application and only runs locally using postgres and local directories"

This clarifies that:
1. The application runs entirely on the user's local machine
2. PostgreSQL is the required database
3. Local filesystem storage for documents (existing pattern)

## Decision Drivers

1. **Local-first**: Must run entirely on user's machine
2. **Board directive**: PostgreSQL is specified
3. **Relational model**: Natural fit for applications + status history
4. **Developer experience**: Type-safe ORM, good tooling
5. **Data ownership**: User controls their own data
6. **Offline capability**: Works without internet

## Options Considered

### Option A: SQLite

**Description**: Embedded database stored in a single file.

**Pros**:
- Zero configuration
- Single file backup
- No separate process
- Works offline

**Cons**:
- Limited concurrent access
- Fewer data types
- Less familiar to some developers
- Migration tooling less mature

**Assessment**: Viable, but not what the board specified.

### Option B: PostgreSQL (Local)

**Description**: PostgreSQL server running locally (via Docker or native install).

**Pros**:
- Full SQL capabilities
- ACID transactions
- Rich data types (JSONB, arrays, enums)
- Mature ecosystem (Drizzle, Prisma, etc.)
- Easy Docker setup
- Familiar to most developers
- Board-specified requirement

**Cons**:
- Requires separate process
- Slightly more setup than SQLite
- ~100MB Docker image

**Assessment**: Best fit — matches board requirement and provides robust features.

### Option C: DynamoDB (Cloud)

**Description**: AWS managed NoSQL database (original design).

**Pros**:
- Serverless, auto-scaling
- Pay-per-request

**Cons**:
- **Rejected by board**: Not local-first
- Requires internet connection
- Cloud costs
- Data leaves user's machine

**Assessment**: Rejected. Does not meet local-first requirement.

## Decision

**Adopt PostgreSQL running locally.**

### Rationale

1. **Board directive**: The board explicitly specified PostgreSQL and local operation.

2. **Local-first architecture**: PostgreSQL runs on `localhost:5432`, keeping all data on the user's machine.

3. **Relational model**: Applications with status history is a natural 1:N relationship that benefits from foreign keys, joins, and cascading deletes.

4. **Transactions**: Status updates that need to atomically create history entries are straightforward with PostgreSQL transactions.

5. **Developer experience**: Drizzle ORM provides type-safe queries with excellent TypeScript integration.

6. **Docker simplicity**: One-liner to start PostgreSQL:
   ```bash
   docker run -d -p 5432:5432 -e POSTGRES_DB=job_app_manager postgres:15
   ```

### Trade-offs Accepted

- **Setup step**: Users need Docker or native PostgreSQL installed
- **Resource usage**: PostgreSQL uses ~50-100MB RAM when idle
- **No cloud sync**: Single-device by default (acceptable for MVP)

### Migration Path

If future requirements include multi-device sync:
1. Add optional cloud sync layer (e.g., CRDTs, or simple REST sync)
2. Or provide export/import to move data between machines
3. PostgreSQL schema remains unchanged

## Consequences

### Positive

- User owns their data locally
- Works offline
- Full SQL query capability
- Type-safe ORM with Drizzle
- Simple backup (pg_dump)
- No ongoing cloud costs

### Negative

- Requires Docker or PostgreSQL installation
- Single-device only (MVP scope)
- User responsible for backups

### Neutral

- Standard relational schema design
- Migrations via Drizzle Kit

## Implementation Notes

See [DATA_MODEL.md](../DATA_MODEL.md) for the PostgreSQL schema implementing this decision.

Key tables:
- `applications`: Core application records with status enum
- `status_history`: Audit trail with foreign key to applications

## References

- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Docker PostgreSQL](https://hub.docker.com/_/postgres)
- [Requirements Plan (WIC-15)](/WIC/issues/WIC-15#document-plan)
