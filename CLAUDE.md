# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Development
- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run setup` - Generate JWT secret for development

### Testing
- `npm run test` - Run all tests (unit + integration) with Vitest
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage
- `npm run test:unit` - Run unit tests only
- `npm run test:unit:watch` - Run unit tests in watch mode
- `npm run test:integration` - Run integration tests
- `npm run test:integration:watch` - Run integration tests in watch mode
- `npm run test:integration:full` - Full integration test cycle with database
- `npx playwright test` - Run E2E tests with Playwright
- `npx playwright test --ui` - Run E2E tests in UI mode
- `npx playwright test --headed` - Run E2E tests in headed browser mode

### Database Management
- `npx prisma studio` - Open Prisma Studio (database GUI)
- `npx prisma migrate dev` - Create and apply migrations
- `npx prisma generate` - Generate Prisma client
- `npx prisma db push` - Push schema changes to database

### Test Database
- `npm run test:db:start` - Start test database (Docker)
- `npm run test:db:stop` - Stop test database
- `npm run test:db:setup` - Setup test database
- `npm run test:db:cleanup` - Cleanup test database
- `npm run test:db:reset` - Reset test database

### Utility Scripts
- `npm run seed:auto-seed` - Seed workspace with GitHub-linked user
- `npm run test:decrypt` - View critical database fields
- `npm run mock-server` - Start mock server for testing
- `npm run migrate:encrypt` - Encrypt existing sensitive data
- `npm run migrate:e2e-tasks -- --workspace=<slug>` - Migrate existing E2E tests from graph to task records for a workspace
- `npm run migrate:e2e-tasks -- --all` - Migrate E2E tests to task records for all workspaces
- `npm run rotate-keys` - Rotate encryption keys
- `npx shadcn@latest add [component]` - Add shadcn/ui components

## Project Overview

Hive Platform is an AI-first PM toolkit that hardens codebases and lifts test coverage through automated "janitor" workflows. It provides actionable recommendations to improve testing, maintainability, performance, and security.

Key features:
- **Janitor System**: Automated codebase analysis with AI-powered recommendations
- **Task Management**: AI-enhanced task tracking with chat integration
- **GitHub Integration**: Deep GitHub App integration for repo access and webhook handling
- **Workspace Management**: Multi-tenant workspaces with role-based access control
- **Learning System**: Captures and organizes insights from codebase analysis

## Architecture Overview

### Tech Stack
- **Frontend**: Next.js 15 with App Router, React 19, TypeScript
- **Styling**: Tailwind CSS v4, shadcn/ui components with Radix UI
- **Backend**: Next.js API routes, Prisma ORM, PostgreSQL
- **Authentication**: NextAuth.js with GitHub OAuth + GitHub App integration
- **Testing**: Vitest with Testing Library, Playwright for E2E
- **Forms**: React Hook Form + Zod validation
- **State Management**: Zustand for client state, TanStack React Query for server state
- **Real-time**: Pusher for live updates
- **AI Integration**: aieo, task-master-ai packages
- **Security**: Field-level encryption for sensitive data (tokens, API keys)

### Key Directories

#### `/src/app` - Next.js App Router
- API routes organized by feature: `/api/auth`, `/api/github`, `/api/workspaces`, `/api/stakwork`, etc.
- Workspace pages under `/w/[slug]/*`: tasks, insights, learn, stakgraph, settings, user-journeys, task/[...taskParams]
- Authentication flows via NextAuth.js
- Workspace onboarding wizard at `/onboarding/workspace` (3-step wizard: Welcome → GitHub Auth → Project Setup)
- Cron job endpoints: `/api/cron/janitors`

#### `/src/components` - React Components
- `ui/` - shadcn/ui components (Button, Dialog, Input, etc.)
- `stakgraph/` - Components for stakgraph integration and forms
- `onboarding/` - Workspace setup form components (OnboardingHeader, WorkspaceForm, FormField)
- `tasks/` - Task management and display components
- `insights/` - Janitor insights and recommendations display
- Any time you create a react component, create a directory always call the file index.tsx

#### `/src/lib` - Core Utilities
- `auth/` - NextAuth.js configuration, workspace resolution, role-based access
- `encryption/` - Field encryption service, crypto utilities for sensitive data
- `ai/` - AI tool integrations (askTools, utils)
- `db.ts` - Prisma client instance
- `utils.ts` - General utility functions and helpers
- `service-factory.ts` - Service factory for external API integrations
- `feature-flags.ts` - Feature flag management with role-based access
- `githubApp.ts` - GitHub App installation and token management
- `pusher.ts` - Real-time event broadcasting configuration

#### `/src/services` - External API Services
- Minimal service architecture for Stakwork and Pool Manager APIs
- Uses native fetch with singleton pattern
- Service factory for managing instances

#### `/src/hooks` - React Hooks
- `useWorkspace.ts` - Core workspace operations and data management
- `useWorkspaceAccess.ts` - Permission checking and access control
- `useFeatureFlag.ts` - Feature flag access checks
- `useGithubApp.ts` - GitHub App integration utilities
- Workspace-specific hooks for different features

#### `/src/stores` - Zustand State Management
- `useCoverageStore.ts` - Test coverage visualization state
- `useStakgraphStore.ts` - Stakgraph component state
- `useModalsStore.ts` - Global modal state management
- `useInsightsStore.ts` - Janitor insights filtering and display state

#### `/src/types` - TypeScript Types
- Comprehensive type definitions for all entities
- Workspace, user, task, and service types
- Wizard and form types

### Database Schema (Prisma)

The database follows a hierarchical structure:
- **Users & Authentication**: NextAuth.js tables (`Account`, `Session`, `User`), `GitHubAuth` for GitHub user data
- **Source Control**: `SourceControlOrg` (GitHub orgs/users), `SourceControlToken` (encrypted installation tokens)
- **Workspaces**: Multi-tenant workspace system with role-based access (`Workspace`, `WorkspaceMember`)
- **Infrastructure**: `Swarm` (deployment infrastructure), `Repository` (linked Git repos)
- **Task Management**: `Task` model with AI chat integration (`ChatMessage`), dual-status tracking, and file attachments (`Attachment`, `Artifact`)
  - **Dual Status Fields**:
    - `status` (TaskStatus) - User/PM work tracking: TODO, IN_PROGRESS, DONE, CANCELLED, BLOCKED
    - `workflowStatus` (WorkflowStatus) - System automation state: PENDING, IN_PROGRESS, COMPLETED, ERROR, HALTED, FAILED
    - Example: `status: DONE` + `workflowStatus: FAILED` = merged code but test failing
  - **User Journey Tasks**:
    - `sourceType: USER_JOURNEY` - E2E tests tracked as tasks for filtering and viewing
    - `testFilePath` - Path to test file (e.g., `src/__tests__/e2e/specs/login.spec.ts`)
    - `testFileUrl` - GitHub URL to test file
    - Metadata records; actual test code stored in the graph
    - Status lifecycle: Recording (IN_PROGRESS) → Review (TODO) → Deployed (DONE)
    - WorkflowStatus tracks test execution pass/fail
- **Janitor System**: `JanitorRun`, `JanitorRecommendation`, `JanitorConfig` for automated code quality analysis
- **Learning**: `Learning` model for capturing insights from codebase analysis
- Encrypted fields use JSON format: `{ data: string, iv: string, tag: string, keyId?: string, version: string, encryptedAt: string }`

### Permission System

Role hierarchy (from highest to lowest):
- `OWNER` - Full workspace control
- `ADMIN` - Manage users, settings, repositories  
- `PM` - Product management, features, roadmaps
- `DEVELOPER` - Development tasks, content creation
- `STAKEHOLDER` - Limited content interaction
- `VIEWER` - Read-only access

Use `useWorkspaceAccess()` hook for permission checks in components.

### Service Architecture

External API integrations use a service factory pattern:
- `ServiceFactory` manages singleton instances
- `BaseServiceClass` provides common HTTP client functionality
- Services: `StakworkService`, `PoolManagerService`
- Configuration in `/src/config/services.ts`

### Jarvis Node Operations

Workspace-specific Jarvis API calls use a different pattern (not ServiceFactory) since each workspace has its own swarm:

**Service Layer:** `/src/services/swarm/api/nodes.ts`
- Pure functions accepting `JarvisConnectionConfig` (jarvisUrl + decrypted apiKey)
- Currently supports: `updateNode(config, { ref_id, properties })`
- Extensible for future CRUD operations (createNode, getNode, deleteNode, listNodes)

**API Route:** `/api/workspaces/[slug]/nodes/[nodeId]`
- Uses `getWorkspaceSwarmAccess()` to get decrypted credentials
- Uses `getJarvisUrl(swarmName)` to build `https://{swarmName}.sphinx.chat:8444`

**Usage from other endpoints/crons:**
```typescript
import { updateNode } from "@/services/swarm/api/nodes";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisUrl } from "@/lib/utils/swarm";

const access = await getWorkspaceSwarmAccess(slug, userId);
const config = { jarvisUrl: getJarvisUrl(access.data.swarmName), apiKey: access.data.swarmApiKey };
await updateNode(config, { ref_id: "...", properties: { is_muted: true } });
```

## Development Guidelines

### Adding New Components
```bash
# Add shadcn/ui components
npx shadcn@latest add [component-name]
```

### Authentication Flow
- **NextAuth.js** with GitHub OAuth provider for user authentication
- **GitHub App** integration for repository access (installation tokens stored encrypted)
- **Mock auth provider** available when `POD_URL` is set (development/codespace environments)
- Workspace access resolved through middleware (`/src/lib/auth/workspace-resolver.ts`)
- Session management integrated with Prisma adapter
- Token encryption/decryption handled by `FieldEncryptionService`

### Working with Workspaces
- All workspace pages use `/w/[slug]/*` pattern
- Use `useWorkspace()` for workspace data and operations
- Use `useWorkspaceAccess()` for permission checks
- Workspace context is provided by `WorkspaceProvider`
- Each workspace can be linked to a GitHub org/user via `SourceControlOrg`

### Task Status Architecture
Tasks use two distinct status fields that serve different purposes:

**status (TaskStatus)** - User/PM-controlled work lifecycle:
- Tracks task completion from a product management perspective
- Values: `TODO`, `IN_PROGRESS`, `DONE`, `CANCELLED`, `BLOCKED`
- Updated manually by users or PMs to reflect work state
- For user journeys: Recording → Pending Review → Merged/Deployed

**workflowStatus (WorkflowStatus)** - System-managed automation state:
- Tracks automated workflow execution health (Stakwork, Playwright, agents)
- Values: `PENDING`, `IN_PROGRESS`, `COMPLETED`, `ERROR`, `HALTED`, `FAILED`
- Updated automatically by system when workflows run
- For user journeys: Test execution results (pass/fail)
- Displayed via `WorkflowStatusBadge` component with icons and colors

**How They Work Together:**
- A task can be "done" from a PM perspective but have a failing test
- Example: `status: DONE` + `workflowStatus: FAILED` = code merged but CI failing
- Example: `status: IN_PROGRESS` + `workflowStatus: PENDING` = actively coding, test queued
- Example: `status: DONE` + `workflowStatus: COMPLETED` = shipped and passing

**Real-time Updates:**
- Status changes broadcast via Pusher to workspace channels
- Components using `useWorkspaceTasks` hook receive live updates
- Event: `WORKSPACE_TASK_TITLE_UPDATE` (reused for all task updates)

### GitHub App Integration
- GitHub App provides repository-level access beyond OAuth scope
- Installation tokens are encrypted and stored in `SourceControlToken`
- `/api/github/app/install` - Initiates GitHub App installation flow
- `/api/github/app/callback` - Handles installation callback
- `/api/github/webhook` - Processes GitHub webhook events
- Use `githubApp.ts` utilities for token management and API calls

### Database Migrations
- **CRITICAL**: When adding new columns/tables to `prisma/schema.prisma`, ALWAYS create a migration with `npx prisma migrate dev --name <description>`
- Never modify the schema without creating a migration - this causes production database sync issues
- Always run `npx prisma migrate dev` for schema changes
- Use `npx prisma generate` after schema modifications
- Test database changes with integration tests
- Verify migration files are committed and deployed to production

### Testing Strategy
- **Unit tests**: Utilities, hooks, components, and pure functions (67+ test files, 1800+ test cases)
- **Integration tests**: API routes, database operations, and service integrations (19+ test files, 300+ test cases)
- **E2E tests**: Critical user flows with Playwright (workspace settings, etc.)
- **Test database**: Separate PostgreSQL database via Docker Compose (`docker-compose.test.yml`)
- **Test isolation**: Database cleanup before/after each integration test
- **Configuration**: `vitest.config.ts` for Vitest, `playwright.config.ts` for Playwright
- **Coverage**: Run `npm run test:coverage` to generate coverage reports

### E2E Test Guidelines
**Structure**: `src/__tests__/e2e/` → `specs/[feature]/` (tests), `support/page-objects/` (Page Objects), `support/fixtures/` (selectors, scenarios, database, test-hooks), `support/helpers/` (assertions, waits, navigation)

**Before Writing - Check Existing Code**:
- `fixtures/selectors.ts` - selector already exists?
- `page-objects/` - Page Object already exists?
- `helpers/` - helper function already exists? (assertions, waits, navigation)
- `fixtures/e2e-scenarios.ts` - test scenario already exists?
- `fixtures/database.ts` - data factory already exists?

**Core Rules**:
- Use `AuthPage.signInWithMock()` for authentication (never real GitHub)
- Use `selectors.ts` for all selectors (never hardcode)
- Use Page Objects for all interactions (never direct `page.locator()` in tests)
- Add `data-testid` to components first, then add to `selectors.ts`
- Import database cleanup: `import { test } from '@/__tests__/e2e/support/fixtures/test-hooks'` for auto-cleanup
- File placement: `specs/[feature-area]/[feature-name].spec.ts`

**Selector Workflow**:
1. Check `selectors.ts` → 2. If missing, add `data-testid` to component → 3. Add to `selectors.ts` → 4. Use `selectors.category.element`
Priority: `data-testid` > semantic selectors > text selectors

**Page Objects**:
- Existing: `AuthPage`, `DashboardPage`, `TasksPage`
- Must have: `goto()`, `waitForLoad()`, action methods
- New Page Object → create in `page-objects/` → export from `index.ts`

**Available Helpers**:
- Assertions: `assertVisible`, `assertContainsText`, `assertElementCount`, `assertURLPattern`
- Waits: `waitForElement`, `waitForLoadingToComplete`, `waitForCondition`
- Navigation: `extractWorkspaceSlug`, `extractTaskId`, `waitForNavigation`
- Scenarios: `createStandardWorkspaceScenario`, `createWorkspaceWithTasksScenario`, `createWorkspaceWithMembersScenario`

**Anti-Patterns**:
❌ Hardcoded selectors | ❌ Direct `page.locator()` in tests | ❌ Duplicate setup code | ❌ Real GitHub auth | ❌ Missing `waitForLoad()` | ❌ No `data-testid`

### Environment Setup
Required environment variables (see `env.example` for complete list):
- `DATABASE_URL` - PostgreSQL connection string
- `NEXTAUTH_URL` - Application URL
- `NEXTAUTH_SECRET` - Session encryption secret (generate with `npm run setup`)
- `JWT_SECRET` - 64-character hex secret for JWT signing
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` - GitHub OAuth credentials
- `GITHUB_APP_SLUG` - GitHub App slug for installation
- `TOKEN_ENCRYPTION_KEY` - 32+ character key for encrypting sensitive tokens
- `TOKEN_ENCRYPTION_KEY_ID` - Key version ID (e.g., "k2")
- `STAKWORK_API_KEY` / `STAKWORK_BASE_URL` - Stakwork API integration
- `POOL_MANAGER_API_KEY` / `POOL_MANAGER_BASE_URL` - Pool Manager API
- `PUSHER_*` - Pusher credentials for real-time features
- `NEXT_PUBLIC_PUSHER_*` - Client-side Pusher keys
- `POD_URL` - Optional mock auth provider for development

### Code Style
- Uses ESLint with Next.js configuration
- Tailwind CSS for styling
- TypeScript strict mode enabled
- Prettier for code formatting
- Use comments sparingly
- Components should own their data and handlers (avoid prop drilling)
- Move static functions/configs outside components to prevent recreations
- Avoid setTimeout for delays - use proper async/loading states instead

### Feature Flags
The application uses environment-based feature flags with role-based access control. See `/docs/feature-flags.md` for complete documentation.

**Quick Reference:**
```typescript
// Check feature access in components
const canAccess = useFeatureFlag('CODEBASE_RECOMMENDATION');

// Add to .env.local for client-side features
NEXT_PUBLIC_FEATURE_CODEBASE_RECOMMENDATION=true
```

**Important:** Next.js client-side feature flags require `NEXT_PUBLIC_` prefix and explicit environment variable references due to build-time optimization. When adding new features, update the switch statement in `/src/lib/feature-flags.ts`.

### Janitor Cron Jobs
Automated janitor runs via Vercel cron jobs. Configure with:
- `JANITOR_CRON_ENABLED=true` - Enable automation
- `CRON_SECRET="token"` - Endpoint security
- Schedule configured in `vercel.json` (currently every 6 hours: `"0 */6 * * *"`)

Endpoint: `/api/cron/janitors` (processes all enabled workspaces)

### Encryption & Security
- **Field-level encryption**: Sensitive fields (OAuth tokens, API keys) are encrypted at rest
- **Encryption service**: `FieldEncryptionService` in `/src/lib/encryption/field-encryption.ts`
- **Key rotation**: Use `npm run rotate-keys` to rotate encryption keys
- **Migration**: Use `npm run migrate:encrypt` to encrypt existing unencrypted data
- **Encrypted fields**: Access tokens, refresh tokens, API keys, webhook secrets
- Token encryption uses AES-256-GCM with versioned keys for rotation support

### User Journey Task Tracking
User journey E2E tests are automatically tracked as tasks to enable filtering, viewing, and status management alongside other work items.

**How it works:**
- When a user records an E2E test via the browser panel, a task is automatically created with `sourceType: USER_JOURNEY`
- The test code itself is stored in the swarm graph (source of truth)
- Task records store metadata: title, status, test file path, and GitHub URL
- Status tracking: Recording (IN_PROGRESS) → Pending Review (TODO) → Merged (DONE)

**Viewing user journey tasks:**
- Navigate to `/w/[slug]/user-journeys` to see all E2E tests
- Task API supports filtering: `/api/tasks?sourceType=USER_JOURNEY`
- Tasks appear in the main task list regardless of TODO status (always visible)

**Migration for existing tests:**
- Use `npm run migrate:e2e-tasks -- --workspace=<slug>` to backfill existing E2E tests from graph as task records
- Use `npm run migrate:e2e-tasks -- --all` to migrate all workspaces
- Migration script queries the swarm graph for E2etest nodes and creates corresponding tasks
- Duplicate detection prevents re-migration (checks by testFilePath)
- Migrated tests are marked as DONE with workflowStatus: COMPLETED
- Configure graph service port via `GRAPH_SERVICE_PORT` environment variable (default: 3355)

**Rolling back migration:**
- To remove migrated tasks: `DELETE FROM tasks WHERE source_type = 'USER_JOURNEY' AND workflow_status = 'COMPLETED'`
- Migration is idempotent - can be safely re-run after rollback
- Warning: This will permanently delete task records (test code in graph is preserved)