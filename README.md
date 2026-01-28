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

## API Routes

The platform exposes 150+ API endpoints organized by feature area. All routes are prefixed with `/api/`.

### Authentication & Authorization
- `GET /api/auth/[...nextauth]` - NextAuth.js authentication handlers
- `POST /api/auth/revoke-github` - Revoke GitHub OAuth tokens
- `POST /api/auth/verify-token` - Verify JWT token

### Workspace Management
- `GET /api/workspaces` - List user workspaces
- `POST /api/workspaces` - Create new workspace (API token auth)
- `DELETE /api/workspaces` - Batch delete workspaces
- `GET /api/workspaces/:slug` - Get workspace details
- `PUT /api/workspaces/:slug` - Update workspace settings
- `DELETE /api/workspaces/:slug` - Delete workspace
- `DELETE /api/workspaces/id/:id` - Delete workspace by ID (API token auth)
- `GET /api/workspaces/slug-availability` - Check slug availability
- `POST /api/workspaces/:slug/access` - Record workspace access timestamp
- `GET /api/workspaces/:slug/validate` - Validate workspace configuration
- `GET /api/workspaces/:slug/image` - Get workspace image
- `GET /api/workspaces/:slug/search` - Search workspace content

### Workspace Members
- `GET /api/workspaces/:slug/members` - List workspace members
- `POST /api/workspaces/:slug/members` - Add workspace member
- `PATCH /api/workspaces/:slug/members/:userId` - Update member role
- `DELETE /api/workspaces/:slug/members/:userId` - Remove member
- `POST /api/members` - Programmatic member invite (API token auth)
- `PATCH /api/members` - Update member role (API token auth)
- `DELETE /api/members` - Remove member (API token auth)

### Workspace Settings
- `POST /api/workspaces/:slug/settings/image/upload-url` - Get presigned URL for image upload
- `DELETE /api/workspaces/:slug/settings/image` - Delete workspace image
- `POST /api/workspaces/:slug/settings/image/confirm` - Confirm image upload
- `GET /api/workspaces/:slug/settings/node-type-order` - Get node type display order
- `PUT /api/workspaces/:slug/settings/node-type-order` - Update node type order
- `GET /api/workspaces/:slug/settings/vercel-integration` - Get Vercel integration settings
- `PUT /api/workspaces/:slug/settings/vercel-integration` - Update Vercel integration

### Task Management
- `GET /api/tasks` - List tasks
- `POST /api/tasks` - Create task
- `GET /api/tasks/stats` - Get task statistics
- `POST /api/tasks/create-from-transcript` - Create task from transcript
- `GET /api/task/:taskId` - Get task details (legacy route)
- `GET /api/tasks/:taskId` - Get task details
- `PATCH /api/tasks/:taskId` - Update task
- `PUT /api/tasks/:taskId/title` - Update task title
- `PUT /api/tasks/:taskId/webhook` - Configure task webhook
- `GET /api/tasks/:taskId/messages` - Get task chat messages
- `POST /api/tasks/:taskId/messages/save` - Save task message
- `POST /api/tasks/:taskId/recording` - Upload task recording
- `GET /api/tasks/:taskId/artifacts/:artifactId/url` - Get artifact presigned URL
- `GET /api/workspaces/:slug/tasks/notifications-count` - Get unread notification count

### Tickets
- `GET /api/tickets/:ticketId` - Get ticket details
- `PATCH /api/tickets/:ticketId` - Update ticket
- `DELETE /api/tickets/:ticketId` - Delete ticket
- `POST /api/tickets/reorder` - Reorder tickets

### Product Planning (Features, Phases, User Stories)
- `GET /api/features` - List features
- `POST /api/features` - Create feature
- `GET /api/features/:featureId` - Get feature details
- `PUT /api/features/:featureId` - Update feature
- `DELETE /api/features/:featureId` - Delete feature
- `GET /api/phases/:phaseId` - Get phase details
- `PATCH /api/phases/:phaseId` - Update phase
- `DELETE /api/phases/:phaseId` - Delete phase
- `PATCH /api/user-stories/:storyId` - Update user story
- `DELETE /api/user-stories/:storyId` - Delete user story

### GitHub Integration
- `POST /api/github/app/install` - Start GitHub App installation
- `GET /api/github/app/callback` - GitHub OAuth callback
- `GET /api/github/app/status` - Check GitHub connection status
- `GET /api/github/app/check` - Verify repository access
- `POST /api/github/app/webhook` - GitHub App webhook handler
- `GET /api/github/repositories` - List accessible repositories
- `GET /api/github/repository` - Get repository details
- `POST /api/github/repository/permissions` - Check repository permissions
- `GET /api/github/repository/data` - Get repository metadata
- `GET /api/github/repository/branches` - List repository branches
- `GET /api/github/repository/branch/numofcommits` - Get branch commit count
- `GET /api/github/users/search` - Search GitHub users
- `POST /api/github/webhook/:workspaceId` - Workspace-specific webhook receiver
- `POST /api/github/webhook/ensure` - Create/update webhooks
- `PUT /api/repositories/:id` - Update repository configuration

### Swarm & Code Graph
- `POST /api/swarm` - Create swarm
- `PUT /api/swarm` - Update swarm configuration
- `GET /api/swarm/validate` - Validate swarm configuration
- `POST /api/swarm/poll` - Poll swarm creation status
- `GET /api/swarm/poll` - Get swarm status
- `POST /api/super/new_swarm` - Create swarm (superadmin)

### Swarm - Jarvis (Graph Database)
- `GET /api/swarm/jarvis/nodes` - Query graph nodes
- `GET /api/swarm/jarvis/schema` - Get graph schema
- `POST /api/swarm/jarvis/search-by-types` - Search nodes by type

### Swarm - Stakgraph
- `GET /api/swarm/stakgraph/status` - Get stakgraph status
- `POST /api/swarm/stakgraph/sync` - Sync stakgraph
- `GET /api/swarm/stakgraph/ingest` - Get ingestion status
- `POST /api/swarm/stakgraph/ingest` - Trigger code ingestion
- `GET /api/swarm/stakgraph/services` - List stakgraph services
- `GET /api/swarm/stakgraph/agent-stream` - Stream AI agent responses
- `POST /api/swarm/stakgraph/webhook` - Stakgraph webhook handler
- `GET /api/workspaces/:slug/stakgraph` - Get workspace stakgraph config
- `PUT /api/workspaces/:slug/stakgraph` - Update stakgraph configuration

### Graph Visualization
- `GET /api/workspaces/:slug/graph/nodes` - Get graph nodes for visualization
- `GET /api/workspaces/:slug/graph/gitree` - Get git tree structure
- `GET /api/workspaces/:slug/nodes` - List workspace nodes
- `PUT /api/workspaces/:slug/nodes/:nodeId` - Update node
- `GET /api/subgraph` - Get subgraph data

### Janitors (Code Quality Analysis)
- `POST /api/workspaces/:slug/janitors/:type/run` - Run specific janitor
- `GET /api/workspaces/:slug/janitors/config` - Get janitor configuration
- `PUT /api/workspaces/:slug/janitors/config` - Update janitor settings
- `GET /api/workspaces/:slug/janitors/recommendations` - Get janitor recommendations
- `GET /api/workspaces/:slug/janitors/runs` - List janitor run history
- `GET /api/cron/janitors` - Automated janitor cron job

### Testing & Coverage
- `GET /api/tests/coverage` - Get test coverage data
- `GET /api/tests/nodes` - Get test nodes from graph
- `GET /api/tests/mocks` - Get mock test data
- `GET /api/user-journeys/:taskId/execute` - Execute user journey test
- `POST /api/user-journeys/:taskId/execute` - Run user journey workflow
- `GET /api/workspaces/:slug/user-journeys` - List workspace user journeys

### Code Analysis & Security
- `GET /api/workspaces/:slug/git-leaks` - Run GitLeaks secret detection
- `GET /api/code-graph/architecture` - Get architecture analysis
- `POST /api/code-graph/wizard-state` - Update wizard state
- `GET /api/code-graph/wizard-state` - Get wizard state

### AI & Workflows
- `POST /api/stakwork/ai/generate` - Generate content with AI
- `POST /api/stakwork/create-customer` - Create Stakwork customer
- `POST /api/stakwork/create-project` - Create Stakwork project
- `GET /api/stakwork/runs` - List workflow runs
- `PATCH /api/stakwork/runs/:runId/decision` - Make workflow decision
- `POST /api/stakwork/user-journey` - Create user journey workflow
- `GET /api/stakwork/workflow/:projectId` - Get workflow details
- `POST /api/stakwork/webhook` - Stakwork webhook handler
- `POST /api/webhook/stakwork/response` - Stakwork response webhook

### Workflow Editor
- `GET /api/workflow/prompts` - List workflow prompts
- `POST /api/workflow/prompts` - Create workflow prompt
- `GET /api/workflow/prompts/:id` - Get prompt details
- `PUT /api/workflow/prompts/:id` - Update prompt
- `POST /api/workflow/publish` - Publish workflow
- `POST /api/workflow-editor` - Workflow editor operations

### Pod Management
- `POST /api/pool-manager/create-pool` - Create pod pool
- `DELETE /api/pool-manager/delete-pool` - Delete pool
- `POST /api/pool-manager/claim-pod/:workspaceId` - Claim pod for workspace
- `POST /api/pool-manager/drop-pod/:workspaceId` - Release workspace pod
- `GET /api/w/:slug/pool/status` - Get pool status
- `GET /api/w/:slug/pool/workspaces` - List pool workspaces
- `POST /api/webhook/pool-manager/launch-failure` - Pod launch failure webhook

### Cron Jobs (Automated Tasks)
- `POST /api/cron/janitors` - Run janitor analysis (scheduled)
- `POST /api/cron/pod-repair` - Monitor and repair pods (scheduled)
- `POST /api/cron/task-coordinator` - Coordinate task dependencies (scheduled)

### Chat & Conversations
- `GET /api/workspaces/:slug/chat/conversations` - List conversations
- `POST /api/workspaces/:slug/chat/conversations` - Create conversation
- `GET /api/workspaces/:slug/chat/conversations/:conversationId` - Get conversation
- `PUT /api/workspaces/:slug/chat/conversations/:conversationId` - Update conversation
- `DELETE /api/workspaces/:slug/chat/conversations/:conversationId` - Delete conversation
- `POST /api/workspaces/:slug/chat/share` - Share conversation
- `GET /api/workspaces/:slug/chat/shared/:shareId` - View shared conversation

### Calls & Transcripts
- `GET /api/workspaces/:slug/calls` - List workspace calls
- `POST /api/workspaces/:slug/calls/generate-link` - Generate call link
- `GET /api/workspaces/:slug/calls/:ref_id/topics` - Get call topics
- `POST /api/transcript/chunk` - Process transcript chunk

### Whiteboards
- `GET /api/whiteboards` - List whiteboards
- `POST /api/whiteboards` - Create whiteboard
- `GET /api/whiteboards/:whiteboardId` - Get whiteboard
- `PATCH /api/whiteboards/:whiteboardId` - Update whiteboard
- `DELETE /api/whiteboards/:whiteboardId` - Delete whiteboard

### Learnings & Documentation
- `GET /api/learnings` - List learnings
- `POST /api/learnings` - Create learning
- `GET /api/learnings/features` - Get feature learnings
- `GET /api/workspaces/:slug/learn/config` - Get learn configuration
- `PUT /api/workspaces/:slug/learn/config` - Update learn settings

### File Uploads & Media
- `POST /api/upload/image` - Upload image
- `POST /api/upload/presigned-url` - Get S3 presigned URL
- `GET /api/screenshots` - List screenshots
- `POST /api/screenshots/upload` - Upload screenshot

### Integrations
- `POST /api/vercel/log-drain` - Vercel log drain endpoint

### Health & Status
- `GET /api/health` - Health check endpoint

### Mock Endpoints (Development)
All mock endpoints are available under `/api/mock/*` when `USE_MOCKS=true`:
- GitHub API mocks (`/api/mock/github/*`)
- Pool Manager mocks (`/api/mock/pool-manager/*`)
- Stakwork mocks (`/api/mock/stakwork/*`)
- Swarm Super Admin mocks (`/api/mock/swarm-super-admin/*`)

> **Note**: Route parameters use `:param` notation in this documentation. In actual API calls, replace with values (e.g., `/api/workspaces/my-workspace`). Dynamic segments in Next.js use `[param]` folder naming.
