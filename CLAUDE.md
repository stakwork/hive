# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Development
- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

### Testing
- `npm run test` - Run all tests with Vitest
- `npm run test:unit` - Run unit tests only
- `npm run test:integration` - Run integration tests
- `npx playwright test` - Run E2E tests

### Database
- `npx prisma migrate dev` - Create and apply migrations
- `npx prisma generate` - Generate Prisma client
- `npx prisma studio` - Open database GUI

### Test Database
- `npm run test:db:start` - Start test database (Docker)
- `npm run test:db:stop` - Stop test database
- `npm run test:db:reset` - Reset test database

### Utility Scripts
- `npm run migrate:e2e-tasks -- --workspace=<slug>` - Migrate E2E tests to task records
- `npm run rotate-keys` - Rotate encryption keys
- `npx shadcn@latest add [component]` - Add shadcn/ui components

## Project Overview

Hive Platform is an AI-first PM toolkit that hardens codebases and lifts test coverage through automated "janitor" workflows.

Key features:
- **Janitor System**: Automated codebase analysis with AI-powered recommendations
- **Task Management**: AI-enhanced task tracking with chat integration and dependency coordination
- **Planning/Roadmap**: Features, phases, and user stories for product planning
- **GitHub Integration**: GitHub App integration for repo access and webhooks
- **Workspace Management**: Multi-tenant workspaces with role-based access control
- **Pod Management**: Automated pod provisioning, repair, and monitoring via Pool Manager

## Architecture Overview

### Tech Stack
- **Frontend**: Next.js 15 with App Router, React 19, TypeScript
- **Styling**: Tailwind CSS v4, shadcn/ui components
- **Backend**: Next.js API routes, Prisma ORM, PostgreSQL
- **Authentication**: NextAuth.js with GitHub OAuth + GitHub App
- **Testing**: Vitest, Playwright for E2E
- **State Management**: Zustand for client state, TanStack React Query for server state
- **Real-time**: Pusher for live updates
- **Security**: Field-level encryption for sensitive data (AES-256-GCM)

### Key Directories

- `/src/app` - Next.js App Router with API routes by feature; workspace pages under `/w/[slug]/*` (tasks, plan, janitors, recommendations, stakgraph, testing, calls, learn, settings)
- `/src/components` - React components; always create directories with `index.tsx` for new components
- `/src/lib` - Core utilities: auth, encryption, AI tools, database client, feature flags
- `/src/services` - External API services using service factory pattern
- `/src/hooks` - React hooks for workspace operations, permissions, and features
- `/src/stores` - Zustand state management stores
- `/src/types` - TypeScript type definitions

### Database Schema

Hierarchical structure: Users/Auth → Source Control → Workspaces → Tasks/Janitors/Features

**Key Models**:
- `Workspace` - main tenant model
- `Swarm`, `Repository` - external service where repository code is processed
- `Task`, `ChatMessage`
- `Feature`, `Phase`, `UserStory` - Product planning hierarchy
- `StakworkRun` - Tracks AI workflow executions (architecture, task generation, user stories, pod repair)

**Task Dual Status System**:
- `status` (TaskStatus) - User/PM work tracking: TODO, IN_PROGRESS, DONE, CANCELLED, BLOCKED
- `workflowStatus` (WorkflowStatus) - System automation state: PENDING, IN_PROGRESS, COMPLETED, ERROR, HALTED, FAILED
- These are independent: a task can be DONE but have FAILED workflow (code merged but CI failing)

**User Journey Tasks**: E2E tests tracked as tasks with `sourceType: USER_JOURNEY`, storing metadata while test code lives in the swarm graph.

Encrypted fields use JSON format with `data`, `iv`, `tag`, `keyId`, `version`, and `encryptedAt` properties.

### Task Modes

Tasks support two primary execution modes, selected via `useTaskMode()` hook (persisted to localStorage):

**Live Mode (default)**: Asynchronous workflow execution via Stakwork. User messages sent to `/api/chat/message` trigger Stakwork workflows, with AI responses delivered via webhooks to `/api/chat/response` and broadcast through Pusher for real-time UI updates. No dedicated pod required. Best for standard async task execution.

**Agent Mode**: Direct streaming connection to a Goose agent running on a claimed pod. Messages sent to `/api/agent` establish a session, returning a stream URL for direct SSE communication. Pod credentials (URL, password) are stored encrypted and never exposed to the frontend. Supports interactive coding with live IDE/browser artifacts. Agent responses persisted via webhook callbacks to `/api/agent/webhook`.

Key differences: Live mode is stateless per-message with Pusher-based updates; Agent mode maintains persistent sessions with direct streaming and requires pod provisioning via Pool Manager.

### Permission System

Role hierarchy: OWNER > ADMIN > PM > DEVELOPER > STAKEHOLDER > VIEWER

Use `useWorkspaceAccess()` hook for permission checks in components.

### Service Architecture

External APIs use `ServiceFactory` with singleton pattern. Jarvis node operations use a different pattern via `/src/services/swarm/api/nodes.ts` since each workspace has its own swarm - use `getWorkspaceSwarmAccess()` for credentials.

## Development Guidelines

### Authentication
- NextAuth.js with GitHub OAuth for user auth
- GitHub App for repository access (tokens stored encrypted)
- Mock auth available when `POD_URL` is set (development)

### Working with Workspaces
- All workspace pages use `/w/[slug]/*` pattern
- Use `useWorkspace()` for data, `useWorkspaceAccess()` for permissions
- Link workspaces to GitHub orgs via `SourceControlOrg`

### Database Migrations
**CRITICAL**: Always create migrations with `npx prisma migrate dev --name <description>` when modifying `schema.prisma`. Never modify schema without a migration.

### Testing Strategy
- **Unit tests**: Components, hooks, utilities
- **Integration tests**: API routes, database operations
- **E2E tests**: Critical user flows with Playwright
- Separate test database via Docker Compose (`docker-compose.test.yml`)

### E2E Test Guidelines

**Structure**: `src/__tests__/e2e/` with `specs/`, `support/page-objects/`, `support/fixtures/`, `support/helpers/`

**Core Rules**:
- Use `AuthPage.signInWithMock()` for authentication (never real GitHub)
- Use `selectors.ts` for all selectors, add `data-testid` to components first
- Use Page Objects for interactions, never direct `page.locator()` in tests
- Check existing helpers, page objects, and scenarios before creating new ones

### Environment Variables
See `env.example` for the complete list. Key variables:
- `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `JWT_SECRET`
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_SLUG`
- `TOKEN_ENCRYPTION_KEY`, `TOKEN_ENCRYPTION_KEY_ID`
- `STAKWORK_*`, `POOL_MANAGER_*`, `PUSHER_*` for integrations

### Code Style
- ESLint + Prettier + TypeScript strict mode
- Comments sparingly; components own their data (avoid prop drilling)
- Move static functions outside components; use async/loading states instead of setTimeout

### Feature Flags
Environment-based with role access control. Use `useFeatureFlag()` hook. Client-side flags require `NEXT_PUBLIC_` prefix. See `/docs/feature-flags.md`.

### Encryption & Security
Field-level encryption via `FieldEncryptionService` for OAuth tokens, API keys. Use `npm run rotate-keys` for key rotation, `npm run migrate:encrypt` for existing data.

### GitHub App Integration
- Installation tokens encrypted in `SourceControlToken`
- Endpoints: `/api/github/app/install`, `/api/github/app/callback`, `/api/github/webhook`
- Use `githubApp.ts` for token management

### Cron Jobs
Three automated cron jobs run via Vercel (configured in `vercel.json`, secured with `CRON_SECRET`):
- `/api/cron/janitors` - Runs janitor analysis on enabled workspaces
- `/api/cron/pod-repair` - Monitors and repairs workspace pods (restarts failed services)
- `/api/cron/task-coordinator` - Coordinates task dependencies and triggers workflows when dependencies are satisfied

### Logging
Use `logger` from `/src/lib/logger.ts` for structured logging with automatic sensitive data sanitization. Supports LOG_LEVEL env var (ERROR, WARN, INFO, DEBUG).
