# Hive Platform

Hive Platform is an AI-first PM toolkit that hardens your codebase and lifts test coverage with async "janitor" workflows—delivering actionable recommendations to improve testing, maintainability, performance, and security.

## Tech Stack

- **Frontend**: Next.js 15 with App Router, React 19, TypeScript
- **Styling**: Tailwind CSS, shadcn/ui components with Radix UI
- **Backend**: Next.js API routes, Prisma ORM, PostgreSQL
- **Authentication**: NextAuth.js with GitHub OAuth
- **State Management**: Zustand for client state, TanStack React Query for server state
- **Testing**: Vitest with Testing Library, Playwright for E2E
- **Forms**: React Hook Form + Zod validation

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL database  
- GitHub OAuth application ([Setup Guide](https://github.com/settings/developers))

### Installation

1. **Clone and install**
```bash
git clone <your-repo-url>
cd hive
npm install
```

2. **Environment setup**
```bash
cp env.example .env.local
# Edit .env.local with your GitHub OAuth credentials and database URL
npm run setup  # Generate JWT secret
```

3. **Database setup**
```bash
# Start PostgreSQL (or use Docker)
docker-compose up -d postgres

# Run migrations
npx prisma generate
npx prisma migrate dev
```

4. **Start development**
```bash
npm run dev
# Open http://localhost:3000
```

## Development Commands

### Core Development
- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build for production  
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run setup` - Generate JWT secret
- `npm run format` - Format code with Prettier

### Testing
- `npm run test` - Run all tests with Vitest
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage
- `npm run test:unit` - Run unit tests only
- `npm run test:integration` - Run integration tests
- `npm run test:integration:full` - Full integration test cycle with database

### Database Management
- `npx prisma studio` - Open Prisma Studio (database GUI)
- `npx prisma migrate dev` - Create and apply migrations
- `npx prisma generate` - Generate Prisma client
- `npx prisma db push` - Push schema changes to database

### Test Database
- `npm run test:db:start` - Start test database
- `npm run test:db:stop` - Stop test database  
- `npm run test:db:setup` - Setup test database
- `npm run test:db:reset` - Reset test database

### Utilities
- `npm run seed:auto-seed` - Seed workspace with GitHub-linked user
- `npm run test:decrypt` - View critical database fields
- `npm run mock-server` - Start mock server for testing
- Mock endpoints available at `/api/mock/*` for development without external dependencies
- `npx shadcn@latest add [component]` - Add shadcn/ui components

## Environment Variables

Required for development:
```env
DATABASE_URL="postgresql://hive_user:hive_password@localhost:5432/hive_db"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-jwt-secret"
GITHUB_CLIENT_ID="your-github-client-id"  
GITHUB_CLIENT_SECRET="your-github-client-secret"
```

Optional environment variables:
- `USE_MOCKS` - Enable mock mode for all external services (`true` to enable)

## API Endpoints

The Hive Platform exposes 200+ REST API endpoints organized by functional domain:

### Agent Operations

- **POST** `/api/agent`
- **POST** `/api/agent/branch`
- **POST** `/api/agent/commit`
- **POST** `/api/agent/diff`
- **POST** `/api/agent/webhook`

### Authentication

- **POST** `/api/auth/revoke-github`
- **POST** `/api/auth/verify-landing`

### Chat & AI

- **POST** `/api/chat/message`
- **GET** `/api/chat/messages/[messageId]`
- **POST** `/api/chat/response`

### Cron Jobs

- **GET** `/api/cron/janitors`
- **GET** `/api/cron/pod-repair`
- **GET** `/api/cron/pr-monitor`
- **GET** `/api/cron/task-coordinator`

### Features & Product Planning

- **GET, POST** `/api/features`
- **DELETE, GET, PATCH** `/api/features/[featureId]`
- **POST** `/api/features/[featureId]/diagram/generate`
- **POST** `/api/features/[featureId]/generate`
- **POST** `/api/features/[featureId]/phases`
- **POST** `/api/features/[featureId]/tasks/assign-all`
- **POST** `/api/features/[featureId]/tickets`
- **GET, POST** `/api/features/[featureId]/user-stories`
- **POST** `/api/features/[featureId]/user-stories/reorder`
- **POST** `/api/features/create-feature`
- **POST** `/api/features/detect-feature-request`

### File & Media

- **GET** `/api/screenshots`
- **POST** `/api/screenshots/upload`
- **POST** `/api/upload/image`
- **POST** `/api/upload/presigned-url`

### GitHub Integration

- **GET** `/api/github/app/callback`
- **GET** `/api/github/app/check`
- **POST** `/api/github/app/install`
- **GET** `/api/github/app/status`
- **POST** `/api/github/app/webhook`
- **GET** `/api/github/pr-metrics`
- **GET** `/api/github/repositories`
- **GET** `/api/github/repository`
- **GET** `/api/github/repository/branch/numofcommits`
- **GET** `/api/github/repository/branches`
- **GET** `/api/github/repository/data`
- **GET, POST** `/api/github/repository/permissions`
- **GET** `/api/github/users/search`
- **POST** `/api/github/webhook`
- **POST** `/api/github/webhook/[workspaceId]`
- **POST** `/api/github/webhook/ensure`

### Janitors

- **POST** `/api/janitors/recommendations/[id]/accept`
- **POST** `/api/janitors/recommendations/[id]/dismiss`
- **POST** `/api/janitors/webhook`

### Mock Endpoints

- **GET** `/api/mock/chat`
- **POST** `/api/mock/jarvis/seed`
- **POST** `/api/mock/pool-manager/create-pool`
- **DELETE** `/api/mock/pool-manager/delete-pool`
- **POST** `/api/mock/pool-manager/drop-pod`
- **POST** `/api/mock/stakwork/create-customer`
- **POST** `/api/mock/stakwork/create-project`
- **POST** `/api/mock/stakwork/webhook`
- **POST** `/api/mock/swarm-super-admin/api/pools/pods/add`
- **GET** `/api/mock/swarm-super-admin/api/super/check-domain`
- **GET** `/api/mock/swarm-super-admin/api/super/details`
- **POST** `/api/mock/swarm-super-admin/api/super/new_swarm`
- **POST** `/api/mock/swarm-super-admin/api/super/stop_swarm`

### Other

- **GET** `/api/ask`
- **POST** `/api/ask/quick`
- **POST** `/api/bounty-request`
- **GET** `/api/check-url`
- **POST** `/api/gitsee`
- **POST** `/api/gitsee/trigger`
- **POST** `/api/graph/webhook`
- **GET, POST** `/api/learnings`
- **GET** `/api/learnings/features`
- **PUT** `/api/repositories/[id]`
- **GET** `/api/subgraph`
- **POST** `/api/transcript/chunk`
- **POST** `/api/vercel/log-drain`
- **GET** `/api/w/[slug]/pool/status`
- **GET** `/api/w/[slug]/pool/workspaces`

### Phases

- **DELETE, GET, PATCH** `/api/phases/[phaseId]`

### Pool Manager

- **POST** `/api/pool-manager/claim-pod/[workspaceId]`
- **POST** `/api/pool-manager/create-pool`
- **DELETE** `/api/pool-manager/delete-pool`
- **POST** `/api/pool-manager/drop-pod/[workspaceId]`

### Stakwork Integration

- **POST** `/api/stakwork/ai/generate`
- **POST** `/api/stakwork/create-customer`
- **POST** `/api/stakwork/create-project`
- **GET** `/api/stakwork/runs`
- **PATCH** `/api/stakwork/runs/[runId]/decision`
- **POST** `/api/stakwork/user-journey`
- **POST** `/api/stakwork/webhook`
- **GET** `/api/stakwork/workflow/[projectId]`

### Swarm & Code Graph

- **POST** `/api/super/new_swarm`
- **POST, PUT** `/api/swarm`
- **GET** `/api/swarm/jarvis/nodes`
- **GET** `/api/swarm/jarvis/schema`
- **POST** `/api/swarm/jarvis/search-by-types`
- **GET, POST** `/api/swarm/poll`
- **GET** `/api/swarm/stakgraph/agent-stream`
- **GET, POST** `/api/swarm/stakgraph/ingest`
- **GET** `/api/swarm/stakgraph/services`
- **GET** `/api/swarm/stakgraph/status`
- **POST** `/api/swarm/stakgraph/sync`
- **POST** `/api/swarm/stakgraph/webhook`
- **GET** `/api/swarm/validate`

### Tasks

- **GET** `/api/task/[taskId]`
- **GET, POST** `/api/tasks`
- **PATCH** `/api/tasks/[taskId]`
- **GET** `/api/tasks/[taskId]/artifacts/[artifactId]/url`
- **GET** `/api/tasks/[taskId]/messages`
- **POST** `/api/tasks/[taskId]/messages/save`
- **POST** `/api/tasks/[taskId]/recording`
- **PUT** `/api/tasks/[taskId]/title`
- **PUT** `/api/tasks/[taskId]/webhook`
- **POST** `/api/tasks/create-from-transcript`
- **GET** `/api/tasks/stats`

### Testing

- **GET** `/api/tests/coverage`
- **GET** `/api/tests/mocks`
- **GET** `/api/tests/nodes`

### Tickets

- **DELETE, GET, PATCH** `/api/tickets/[ticketId]`
- **POST** `/api/tickets/reorder`

### User Stories & Journeys

- **POST** `/api/user-journeys/[taskId]/execute`
- **DELETE, PATCH** `/api/user-stories/[storyId]`

### Webhooks

- **POST** `/api/webhook/pool-manager/launch-failure`
- **POST** `/api/webhook/stakwork/response`

### Whiteboards

- **GET, POST** `/api/whiteboards`
- **DELETE, GET, PATCH** `/api/whiteboards/[whiteboardId]`

### Workflows

- **POST** `/api/workflow-editor`
- **GET, POST** `/api/workflow/prompts`
- **GET, PUT** `/api/workflow/prompts/[id]`
- **POST** `/api/workflow/publish`

### Workspaces

- **DELETE, GET, POST** `/api/workspaces`
- **GET** `/api/workspaces/slug-availability`

### Workspace-Specific

- **DELETE, GET, PUT** `/api/workspaces/[slug]`
- **POST** `/api/workspaces/[slug]/access`
- **GET** `/api/workspaces/[slug]/calls`
- **GET** `/api/workspaces/[slug]/calls/[ref_id]/topics`
- **POST** `/api/workspaces/[slug]/calls/generate-link`
- **GET, POST** `/api/workspaces/[slug]/chat/conversations`
- **DELETE, GET, PUT** `/api/workspaces/[slug]/chat/conversations/[conversationId]`
- **POST** `/api/workspaces/[slug]/chat/share`
- **GET** `/api/workspaces/[slug]/chat/shared/[shareId]`
- **GET** `/api/workspaces/[slug]/git-leaks`
- **GET** `/api/workspaces/[slug]/graph/gitree`
- **GET** `/api/workspaces/[slug]/graph/nodes`
- **GET** `/api/workspaces/[slug]/image`
- **POST** `/api/workspaces/[slug]/janitors/[type]/run`
- **GET, PUT** `/api/workspaces/[slug]/janitors/config`
- **GET** `/api/workspaces/[slug]/janitors/recommendations`
- **GET** `/api/workspaces/[slug]/janitors/runs`
- **GET, PUT** `/api/workspaces/[slug]/learn/config`
- **GET, POST** `/api/workspaces/[slug]/members`
- **DELETE, PATCH** `/api/workspaces/[slug]/members/[userId]`
- **GET** `/api/workspaces/[slug]/nodes`
- **PUT** `/api/workspaces/[slug]/nodes/[nodeId]`
- **GET** `/api/workspaces/[slug]/search`
- **DELETE** `/api/workspaces/[slug]/settings/image`
- **POST** `/api/workspaces/[slug]/settings/image/confirm`
- **POST** `/api/workspaces/[slug]/settings/image/upload-url`
- **GET, PUT** `/api/workspaces/[slug]/settings/node-type-order`
- **GET, PUT** `/api/workspaces/[slug]/settings/vercel-integration`
- **GET, PUT** `/api/workspaces/[slug]/stakgraph`
- **GET** `/api/workspaces/[slug]/tasks/notifications-count`
- **GET** `/api/workspaces/[slug]/user-journeys`
- **GET** `/api/workspaces/[slug]/validate`
