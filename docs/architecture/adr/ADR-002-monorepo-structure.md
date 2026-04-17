# ADR-002: Monorepo Structure

## Status

**Accepted** (2026-04-17)

## Context

The Job Application Manager codebase has evolved into three distinct packages spread across inconsistent locations:

| Current Location | Package Name | Purpose |
|------------------|--------------|---------|
| Root `src/` | `job-application-manager` | Vite/React frontend |
| `backend/` | `job-app-manager-backend` | AWS CDK infrastructure + Lambda functions |
| `server/` | `job-app-manager-server` | Fastify local backend with Drizzle/PostgreSQL |

This structure has several problems:
1. **Root confusion**: The frontend lives at the repository root, making it unclear where to put shared code
2. **Inconsistent naming**: `backend` vs `server` is confusing (both are "backends" in different contexts)
3. **No shared dependencies**: Each package manages its own node_modules with duplicated dependencies
4. **No unified build**: Each package must be built separately with no orchestration

## Decision Drivers

1. **Clarity**: Clear package boundaries and purposes
2. **Simplicity**: Minimal tooling overhead
3. **Standard practice**: Follow established patterns
4. **Developer experience**: Single install, unified scripts
5. **Future extensibility**: Easy to add new packages (e.g., shared types, CLI tools)

## Options Considered

### Option A: npm Workspaces

**Description**: Built-in npm feature (v7+) for managing multiple packages in a single repository.

**Pros**:
- Built into npm, no extra dependencies
- Single `npm install` at root installs all packages
- Hoisted dependencies reduce duplication
- Simple configuration in root package.json
- Well-documented and widely adopted
- Works with existing npm scripts

**Cons**:
- Task orchestration is basic (no parallelization)
- No built-in caching

**Assessment**: Best fit for our needs given simplicity requirements.

### Option B: pnpm Workspaces

**Description**: Alternative package manager with workspace support and strict dependency resolution.

**Pros**:
- Faster installs via content-addressable storage
- Stricter dependency resolution
- Workspace features similar to npm

**Cons**:
- Requires switching package managers
- Team may be less familiar
- Lock file format change

**Assessment**: Good option, but switching package managers adds friction.

### Option C: Turborepo

**Description**: High-performance build system for monorepos with caching and task orchestration.

**Pros**:
- Intelligent caching
- Parallel task execution
- Dependency graph visualization

**Cons**:
- Additional tooling to learn and maintain
- Overkill for 3 packages
- Adds complexity for minimal benefit at our scale

**Assessment**: Premature optimization. Reconsider if we add 5+ packages.

### Option D: Nx

**Description**: Full-featured monorepo build system with plugins and generators.

**Pros**:
- Powerful caching and task orchestration
- Code generation
- Dependency analysis

**Cons**:
- Steep learning curve
- Heavy dependency footprint
- Significant configuration overhead

**Assessment**: Far too complex for our current needs.

## Decision

**Adopt npm workspaces with the following package structure:**

```
packages/
├── web/          # Vite/React frontend (was: root src/)
├── api/          # Fastify local backend (was: server/)
├── infra/        # AWS CDK infrastructure (was: backend/)
└── shared/       # Shared types and utilities (future)
```

### Package Naming Convention

Each package will be scoped under `@wic/`:
- `@wic/web` — Frontend application
- `@wic/api` — Local backend API server
- `@wic/infra` — AWS CDK infrastructure

### Rationale

1. **Zero new dependencies**: npm workspaces is built-in, requiring no additional tooling.

2. **Clear package purposes**:
   - `web` = user-facing frontend (what you see in the browser)
   - `api` = local backend API (what the frontend talks to)
   - `infra` = cloud infrastructure (deployment/CDK)

3. **Hoisted dependencies**: Shared dependencies like TypeScript are installed once at the root.

4. **Unified scripts**: Root package.json can define workspace-wide commands:
   ```json
   {
     "scripts": {
       "dev": "npm run dev --workspace=@wic/web",
       "dev:api": "npm run dev --workspace=@wic/api",
       "build": "npm run build --workspaces",
       "lint": "npm run lint --workspaces --if-present"
     }
   }
   ```

5. **Future extensibility**: Adding `packages/shared/` for shared types is straightforward when needed.

### Trade-offs Accepted

- **No parallel builds**: We accept sequential builds. Add Turborepo later if this becomes a bottleneck.
- **No build caching**: Acceptable for a 3-package monorepo.
- **Basic task orchestration**: npm workspace scripts are sufficient for now.

## Consequences

### Positive

- Single `npm install` manages all packages
- Clear separation of concerns
- Shared dependencies are deduplicated
- Easy to add new packages
- Consistent structure across the codebase

### Negative

- Requires updating import paths across existing code
- Git history may be affected by directory moves (mitigated by using `git mv`)
- IDE may need project reload after restructure

### Neutral

- Each package retains its own package.json, tsconfig, etc.
- Individual packages can still be worked on in isolation

## Implementation Plan

1. Create `packages/` directory structure
2. Move `src/` content to `packages/web/src/`
3. Move `server/` to `packages/api/`
4. Move `backend/` to `packages/infra/`
5. Update root package.json with workspace configuration
6. Update all import paths as needed
7. Verify builds for all packages
8. Update documentation

## References

- [npm Workspaces Documentation](https://docs.npmjs.com/cli/using-npm/workspaces)
- [Node.js Workspaces Guide](https://nodejs.org/api/packages.html#packages_package_manager_detection)
