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
- `npm run test` - Run all tests with Vitest
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage
- `npm run test:unit` - Run unit tests only
- `npm run test:unit:watch` - Run unit tests in watch mode
- `npm run test:integration` - Run integration tests
- `npm run test:integration:watch` - Run integration tests in watch mode
- `npm run test:integration:full` - Full integration test cycle with database

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
- Workspace pages under `/w/[slug]/*`: tasks, insights, graph, learn, stakgraph, settings, user-journeys
- Authentication and onboarding flows
- Cron job endpoints: `/api/cron/janitors`

#### `/src/components` - React Components
- `ui/` - shadcn/ui components (Button, Dialog, Input, etc.)
- `wizard/` - Multi-step wizard components for workspace setup
- `stakgraph/` - Components for stakgraph integration and forms
- `roadmap/` - Product roadmap management components
- `onboarding/` - User onboarding components
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
- Workspace-specific hooks for different features

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
- **Task Management**: Task hierarchy with AI chat integration, status tracking, and notifications
- **Janitor System**: `JanitorRun`, `JanitorRecommendation` for automated code quality suggestions
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
- Unit tests for utilities and hooks
- Integration tests for API routes and database operations
- Separate test database configuration
- Use `vitest.config.ts` for test configuration

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
