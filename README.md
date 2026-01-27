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

## Application Routes

### Page Routes

#### Public Pages
- `/` - Landing page
- `/about` - About page
- `/auth/signin` - Sign in page
- `/workspaces` - Workspaces list

#### Onboarding
- `/onboarding/workspace` - Workspace creation wizard

#### Settings
- `/settings` - User settings

#### Workspace Pages (requires workspace slug: `/w/[slug]`)
- `/w/[slug]` - Workspace dashboard
- `/w/[slug]/tasks` - Task management
- `/w/[slug]/task/[...taskParams]` - Individual task details
- `/w/[slug]/plan` - Product planning overview
- `/w/[slug]/plan/[featureId]` - Feature details
- `/w/[slug]/phases/[phaseId]` - Phase details
- `/w/[slug]/janitors` - Janitor recommendations
- `/w/[slug]/testing` - Test coverage & user journeys
- `/w/[slug]/user-journeys` - User journey tests
- `/w/[slug]/learn` - Learning center
- `/w/[slug]/recommendations` - AI recommendations
- `/w/[slug]/capacity` - Team capacity planning
- `/w/[slug]/stakgraph` - Code graph configuration
- `/w/[slug]/settings` - Workspace settings
- `/w/[slug]/whiteboards` - Whiteboards list
- `/w/[slug]/whiteboards/[id]` - Whiteboard editor
- `/w/[slug]/tickets/[ticketId]` - Ticket details
- `/w/[slug]/calls` - Meeting recordings
- `/w/[slug]/calls/[ref_id]` - Meeting recording details
- `/w/[slug]/chat/shared/[shareId]` - Shared chat conversation

#### Test/Demo Pages
- `/test/clarifying-questions` - Clarifying questions test page

### API Routes

#### Authentication
- `POST /api/auth/[...nextauth]` - NextAuth.js authentication endpoints
- `POST /api/auth/revoke-github` - Revoke GitHub access
- `POST /api/auth/verify-landing` - Verify landing page access

#### Workspaces
- `GET /api/workspaces` - List user workspaces
- `POST /api/workspaces` - Create workspace
- `GET /api/workspaces/[slug]` - Get workspace details
- `PATCH /api/workspaces/[slug]` - Update workspace
- `DELETE /api/workspaces/[slug]` - Delete workspace
- `GET /api/workspaces/[slug]/access` - Check workspace access
- `GET /api/workspaces/slug-availability` - Check slug availability
- `POST /api/workspaces/[slug]/validate` - Validate workspace configuration

#### Workspace Members
- `GET /api/workspaces/[slug]/members` - List workspace members
- `POST /api/workspaces/[slug]/members` - Add member
- `PATCH /api/workspaces/[slug]/members/[userId]` - Update member role
- `DELETE /api/workspaces/[slug]/members/[userId]` - Remove member

#### Workspace Settings
- `POST /api/workspaces/[slug]/image` - Upload workspace image
- `POST /api/workspaces/[slug]/settings/image/upload-url` - Get presigned upload URL
- `POST /api/workspaces/[slug]/settings/image/confirm` - Confirm image upload
- `PATCH /api/workspaces/[slug]/settings/node-type-order` - Update node type order
- `GET /api/workspaces/[slug]/settings/vercel-integration` - Get Vercel integration status
- `POST /api/workspaces/[slug]/settings/vercel-integration` - Configure Vercel integration

#### Tasks
- `GET /api/tasks` - List all tasks
- `POST /api/tasks` - Create task
- `GET /api/tasks/[taskId]` - Get task details
- `PATCH /api/tasks/[taskId]` - Update task
- `DELETE /api/tasks/[taskId]` - Delete task
- `GET /api/tasks/stats` - Get task statistics
- `POST /api/tasks/create-from-transcript` - Create task from transcript
- `GET /api/tasks/[taskId]/messages` - Get task messages
- `POST /api/tasks/[taskId]/messages/save` - Save task message
- `POST /api/tasks/[taskId]/recording` - Upload task recording
- `PATCH /api/tasks/[taskId]/title` - Update task title
- `GET /api/tasks/[taskId]/artifacts/[artifactId]/url` - Get artifact URL
- `POST /api/tasks/[taskId]/webhook` - Task webhook handler
- `GET /api/workspaces/[slug]/tasks/notifications-count` - Get notifications count

#### Features & Planning
- `GET /api/features` - List features
- `POST /api/features` - Create feature
- `GET /api/features/[featureId]` - Get feature details
- `PATCH /api/features/[featureId]` - Update feature
- `DELETE /api/features/[featureId]` - Delete feature
- `POST /api/features/create-feature` - Create feature with AI
- `POST /api/features/detect-feature-request` - Detect feature request in text
- `POST /api/features/[featureId]/diagram/generate` - Generate feature diagram
- `POST /api/features/[featureId]/generate` - Generate feature details
- `GET /api/features/[featureId]/phases` - Get feature phases
- `POST /api/features/[featureId]/phases` - Create phase

#### Phases & User Stories
- `GET /api/phases/[phaseId]` - Get phase details
- `PATCH /api/phases/[phaseId]` - Update phase
- `DELETE /api/phases/[phaseId]` - Delete phase
- `GET /api/user-stories/[storyId]` - Get user story details
- `PATCH /api/user-stories/[storyId]` - Update user story

#### Janitors & Recommendations
- `GET /api/workspaces/[slug]/janitors/recommendations` - Get janitor recommendations
- `GET /api/workspaces/[slug]/janitors/runs` - Get janitor run history
- `GET /api/workspaces/[slug]/janitors/config` - Get janitor configuration
- `PATCH /api/workspaces/[slug]/janitors/config` - Update janitor configuration
- `POST /api/workspaces/[slug]/janitors/[type]/run` - Trigger janitor run
- `POST /api/janitors/recommendations/[id]/accept` - Accept recommendation
- `POST /api/janitors/recommendations/[id]/dismiss` - Dismiss recommendation
- `POST /api/janitors/webhook` - Janitor webhook handler

#### Learning & Documentation
- `GET /api/learnings` - List learnings
- `POST /api/learnings` - Create learning
- `GET /api/learnings/features` - List feature learnings
- `POST /api/learnings/features/create` - Create feature learning
- `GET /api/learnings/features/[id]` - Get feature learning
- `GET /api/workspaces/[slug]/learn/config` - Get learning configuration
- `PATCH /api/workspaces/[slug]/learn/config` - Update learning configuration

#### Chat & AI
- `POST /api/ask` - Quick AI query
- `POST /api/ask/quick` - Quick AI query with streaming
- `POST /api/chat/message` - Send chat message
- `POST /api/chat/response` - Get AI chat response
- `GET /api/workspaces/[slug]/chat/conversations` - List chat conversations
- `POST /api/workspaces/[slug]/chat/conversations` - Create conversation
- `GET /api/workspaces/[slug]/chat/conversations/[conversationId]` - Get conversation
- `DELETE /api/workspaces/[slug]/chat/conversations/[conversationId]` - Delete conversation
- `POST /api/workspaces/[slug]/chat/share` - Share chat conversation
- `GET /api/workspaces/[slug]/chat/shared/[shareId]` - Get shared conversation

#### Code Graph & Swarm
- `GET /api/workspaces/[slug]/stakgraph` - Get stakgraph configuration
- `POST /api/workspaces/[slug]/stakgraph` - Create/update stakgraph
- `POST /api/swarm` - Create swarm
- `GET /api/swarm/poll` - Poll swarm status
- `POST /api/swarm/validate` - Validate swarm configuration
- `GET /api/swarm/jarvis/nodes` - Get Jarvis nodes
- `GET /api/swarm/jarvis/schema` - Get Jarvis schema
- `POST /api/swarm/jarvis/search-by-types` - Search nodes by types
- `POST /api/swarm/stakgraph/ingest` - Ingest code
- `GET /api/swarm/stakgraph/status` - Get ingestion status
- `POST /api/swarm/stakgraph/sync` - Sync repository
- `GET /api/swarm/stakgraph/services` - Get swarm services
- `POST /api/swarm/stakgraph/agent-stream` - Stream agent responses
- `POST /api/swarm/stakgraph/webhook` - Stakgraph webhook handler
- `GET /api/workspaces/[slug]/graph/gitree` - Get repository tree
- `GET /api/workspaces/[slug]/graph/nodes` - Get graph nodes
- `GET /api/workspaces/[slug]/nodes` - List workspace nodes
- `GET /api/workspaces/[slug]/nodes/[nodeId]` - Get node details
- `GET /api/workspaces/[slug]/search` - Search workspace content
- `GET /api/subgraph` - Get subgraph data
- `POST /api/graph/webhook` - Graph webhook handler

#### GitHub Integration
- `GET /api/github/repositories` - List GitHub repositories
- `GET /api/github/repository` - Get repository details
- `POST /api/github/repository` - Link repository
- `GET /api/github/pr-metrics` - Get PR metrics
- `GET /api/github/app/install` - GitHub App installation URL
- `GET /api/github/app/callback` - GitHub App installation callback
- `GET /api/github/app/check` - Check GitHub App installation
- `POST /api/github/webhook` - GitHub webhook handler
- `GET /api/repositories/[id]` - Get repository
- `DELETE /api/repositories/[id]` - Unlink repository
- `GET /api/workspaces/[slug]/git-leaks` - Check for git leaks

#### Agent Operations
- `POST /api/agent` - Run agent workflow
- `POST /api/agent/branch` - Create branch via agent
- `POST /api/agent/commit` - Create commit via agent
- `POST /api/agent/diff` - Get diff via agent
- `POST /api/agent/webhook` - Agent webhook handler

#### Testing & Coverage
- `GET /api/tests/coverage` - Get test coverage
- `GET /api/tests/mocks` - Get mock definitions
- `POST /api/tests/nodes` - Execute test nodes
- `GET /api/workspaces/[slug]/user-journeys` - Get user journey tests
- `POST /api/workspaces/[slug]/user-journeys` - Create user journey test
- `POST /api/user-journeys/[taskId]/execute` - Execute user journey

#### Tickets & Whiteboards
- `GET /api/tickets/[ticketId]` - Get ticket
- `PATCH /api/tickets/[ticketId]` - Update ticket
- `DELETE /api/tickets/[ticketId]` - Delete ticket
- `POST /api/tickets/reorder` - Reorder tickets
- `GET /api/whiteboards` - List whiteboards
- `POST /api/whiteboards` - Create whiteboard
- `GET /api/whiteboards/[whiteboardId]` - Get whiteboard
- `PATCH /api/whiteboards/[whiteboardId]` - Update whiteboard
- `DELETE /api/whiteboards/[whiteboardId]` - Delete whiteboard

#### Calls & Meetings
- `GET /api/workspaces/[slug]/calls` - List meeting recordings
- `POST /api/workspaces/[slug]/calls` - Create call record
- `POST /api/workspaces/[slug]/calls/generate-link` - Generate meeting link
- `GET /api/workspaces/[slug]/calls/[ref_id]/topics` - Get call topics
- `POST /api/transcript/chunk` - Process transcript chunk

#### Workflows & Automation
- `GET /api/workflow/prompts` - List workflow prompts
- `POST /api/workflow/prompts` - Create workflow prompt
- `GET /api/workflow/prompts/[id]` - Get workflow prompt
- `POST /api/workflow/publish` - Publish workflow
- `GET /api/workflow-editor` - Get workflow editor state
- `POST /api/workflow-editor` - Save workflow editor state
- `GET /api/stakwork/workflow/[projectId]` - Get Stakwork workflow

#### Cron Jobs (Internal)
- `POST /api/cron/janitors` - Run janitor analysis (scheduled)
- `POST /api/cron/pod-repair` - Repair workspace pods (scheduled)
- `POST /api/cron/task-coordinator` - Coordinate task dependencies (scheduled)
- `POST /api/cron/pr-monitor` - Monitor pull requests (scheduled)

#### Stakwork Integration
- `POST /api/stakwork/create-customer` - Create Stakwork customer
- `POST /api/stakwork/create-project` - Create Stakwork project
- `GET /api/stakwork/runs` - List Stakwork runs
- `POST /api/stakwork/runs/[runId]/decision` - Make run decision
- `POST /api/stakwork/user-journey` - Process user journey
- `POST /api/stakwork/ai/generate` - Generate AI content
- `POST /api/stakwork/webhook` - Stakwork webhook handler

#### Pool Manager
- `POST /api/pool-manager/create-pool` - Create pod pool
- `DELETE /api/pool-manager/delete-pool` - Delete pod pool
- `POST /api/pool-manager/claim-pod/[workspaceId]` - Claim pod for workspace
- `POST /api/pool-manager/drop-pod/[workspaceId]` - Release pod from workspace
- `GET /api/w/[slug]/pool/status` - Get pod status
- `GET /api/w/[slug]/pool/workspaces` - List pool workspaces

#### GitSee Integration
- `GET /api/gitsee` - Get GitSee configuration
- `POST /api/gitsee/trigger` - Trigger GitSee analysis

#### File Uploads
- `POST /api/upload/image` - Upload image
- `POST /api/upload/presigned-url` - Get presigned upload URL
- `POST /api/screenshots` - Create screenshot
- `POST /api/screenshots/upload` - Upload screenshot

#### Bounties & Requests
- `POST /api/bounty-request` - Create bounty request

#### Webhooks
- `POST /api/webhook/pool-manager/launch-failure` - Pool manager launch failure webhook
- `POST /api/webhook/stakwork/response` - Stakwork response webhook

#### Utilities
- `GET /api/check-url` - Validate URL
- `POST /api/vercel/log-drain` - Vercel log drain endpoint

#### Mock APIs (Development)
- `POST /api/mock/chat` - Mock chat endpoint
- `POST /api/mock/anthropic/v1/messages` - Mock Anthropic API
- `GET /api/mock/anthropic/v1/models` - Mock Anthropic models
- Various mock endpoints for external services under `/api/mock/*`
