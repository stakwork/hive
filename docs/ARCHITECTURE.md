## Hive Architecture Overview

This document explains how the project is structured and how the main parts work together: frontend (Next.js), backend (API routes), database (Prisma/PostgreSQL), real-time (Pusher), external services (Pool Manager, Swarm, Stakwork), and storage (S3).

### Tech Stack
- **App**: Next.js 15 (App Router), React 19, TypeScript
- **Styles/UI**: Tailwind CSS v4, shadcn/ui (Radix UI)
- **State**: Zustand (client state), TanStack React Query (server state)
- **Auth**: NextAuth.js (GitHub OAuth, optional dev mock)
- **DB/ORM**: PostgreSQL + Prisma
- **Real-time**: Pusher (server + client)
- **Storage**: AWS S3 (presigned uploads)
- **Validation**: Zod
- **Testing**: Vitest + Testing Library
- **Build/Runtime**: `output: "standalone"` (Docker-friendly)

### High-Level Flow
1. User accesses UI pages under `src/app` (App Router).
2. UI calls server routes in `src/app/api/*` for data, auth, uploads, etc.
3. API routes use Prisma (`src/lib/db.ts`) to read/write Postgres per the schema in `prisma/schema.prisma`.
4. Auth is handled by NextAuth (`src/lib/auth/nextauth.ts`) using GitHub OAuth or a dev Credentials mock.
5. Real-time updates publish via Pusher (`src/lib/pusher.ts`), clients subscribe by task/workspace.
6. External service calls (Pool Manager, Swarm, Stakwork) are encapsulated in `src/services/*` via a common `HttpClient`.
7. File uploads use S3 presigned URLs (`src/app/api/upload/presigned-url/route.ts`).

---

## Directory Overview

```text
src/
  app/                    # Next.js App Router
    api/                  # API routes (server)
      auth/               # NextAuth endpoints
      github/             # GitHub integration
      stakwork/           # Stakwork API integration
      pool-manager/       # Pool Manager operations
      swarm/              # Swarm management
      tasks/              # Task CRUD and chat message APIs
      upload/             # S3 presigned URLs
      workspaces/         # Workspace CRUD, members, validation
      chat/               # Chat-related endpoints
    w/[slug]/             # Workspace-scoped pages
      task/[...taskParams]/  # AI chat + artifacts UI
      roadmap/            # Product roadmap UI
      stakgraph/          # Stakgraph config UI
      settings/           # Workspace settings
    onboarding/           # User onboarding flow
    auth/                 # Sign-in, error pages
  components/             # UI components (shadcn/ui, wizard, roadmap, stakgraph)
  hooks/                  # Custom React hooks (workspace, pusher, forms, etc.)
  lib/                    # Core libs: auth, db, env, pusher, encryption, http
  providers/              # React providers (session, theme)
  services/               # External services (Pool Manager, Swarm, S3, Stakwork)
  stores/                 # Zustand stores
  types/                  # Shared TypeScript types
  utils/                  # Utilities
prisma/
  schema.prisma           # Database schema
  migrations/             # Migration history
```

Key configs:
- `next.config.ts`: standalone output, remote image patterns.
- `vitest.config.ts`: unit vs integration suite selection via `TEST_SUITE`.
- `tailwind.config.js`, `postcss.config.mjs` for styles.

---

## Data Model (Prisma)
Schema: `prisma/schema.prisma`. Highlights:
- **Auth**: `User`, `Account`, `Session`, `VerificationToken`, `GitHubAuth` (stores GitHub profile details + scopes).
- **Workspaces**: `Workspace`, `WorkspaceMember` with role enum `WorkspaceRole` (OWNER, ADMIN, PM, DEVELOPER, STAKEHOLDER, VIEWER).
- **Infrastructure**: `Swarm` (deployment/env info), `Repository` (Git repo metadata) linked to a `Workspace`.
- **Product/Planning**: `Product` → `Feature` (with phases, status, priority) → `UserStory` → `Task`.
- **Roadmaps**: `Roadmap`, `RoadmapItem` (time windows, dependencies).
- **Chat/Artifacts**: `ChatMessage` (with `attachments` and generated `artifacts`), `Attachment`, `Artifact`.
- **Comments**: Polymorphic `Comment` linked to Feature/UserStory/Task/Requirement.
- Rich enums for statuses and priorities throughout (see file for full list).

DB client: `src/lib/db.ts` creates a singleton `PrismaClient` (logs queries in dev).

---

## Authentication
File: `src/lib/auth/nextauth.ts`
- **Providers**:
  - GitHub OAuth if `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set.
  - Dev mock via Credentials when `POD_URL` is set (accepts any username, creates/uses a mock user).
- **Adapter**: PrismaAdapter when not using the dev mock.
- **Sessions**:
  - Strategy: `database` normally; `jwt` when using the dev mock (POD mode).
  - `session` callback attaches user id and GitHub info. For real users, fetches from GitHub API and upserts `GitHubAuth` using the stored encrypted PAT.
- **Security**:
  - GitHub `access_token` is encrypted using `EncryptionService` before persisting to `Account`.
  - On re-auth/link events, tokens are (re-)encrypted and saved.

API route entry: `src/app/api/auth/[...nextauth]/route.ts` exports `GET`/`POST` handler.

---

## Environment Configuration
Validation: `src/lib/env.ts`
- Required at runtime (throws if missing):
  - `STAKWORK_API_KEY`, `POOL_MANAGER_API_KEY`, `POOL_MANAGER_API_USERNAME`, `POOL_MANAGER_API_PASSWORD`
  - `SWARM_SUPERADMIN_API_KEY`, `SWARM_SUPER_ADMIN_URL`
  - `STAKWORK_CUSTOMERS_EMAIL`, `STAKWORK_CUSTOMERS_PASSWORD`
- Optional with defaults:
  - `STAKWORK_BASE_URL`, `STAKWORK_WORKFLOW_ID`
  - `POOL_MANAGER_BASE_URL`
  - `API_TIMEOUT`

Other important envs used elsewhere:
- Database: `DATABASE_URL`
- NextAuth: `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- GitHub OAuth: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- Pusher (server): `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`
- Pusher (client): `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`
- S3: `AWS_REGION`, `S3_BUCKET_NAME`

---

## Real-time (Pusher)
File: `src/lib/pusher.ts`
- Server instance for triggering events; client is lazily created in the browser.
- Channel helper: `getTaskChannelName(taskId) => task-{id}`.
- Event constants: `NEW_MESSAGE`, `CONNECTION_COUNT`, `WORKFLOW_STATUS_UPDATE`.

Typical flow: server API mutates data → triggers Pusher event → subscribed UI updates.

---

## File Uploads (S3)
- API: `src/app/api/upload/presigned-url/route.ts`
  - Requires authenticated session (`getServerSession`).
  - Validates payload (Zod) and task existence; builds workspace/swarm context.
  - Validates file type/size; generates a namespaced S3 key via `S3Service`.
  - Returns a short-lived presigned URL for the client to PUT the file.
- Service: `src/services/s3.ts`
  - AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`).
  - `generatePresignedUploadUrl`, `generatePresignedDownloadUrl`, and helpers for path/type/size.

---

## External Services Architecture
Common abstractions:
- `src/lib/base-service.ts`: `BaseServiceClass` wraps a shared `HttpClient`, injects `Authorization: Bearer {apiKey}`, timeout, and adds contextual error handling.
- `src/lib/http-client.ts`: thin fetch wrapper with JSON handling, timeouts, and structured `ApiError`s.

Implemented services:
- `src/services/pool-manager/PoolManagerService.ts`
  - Endpoints: create/get/update/delete pool, create user, fetch/update env vars.
  - Decrypts stored `poolApiKey` when making calls.
- `src/services/swarm/SwarmService.ts`
  - Endpoints: create swarm, validate URIs.
- `src/services/stakwork` and `src/app/api/stakwork/*`: customer/project creation and webhooks.

---

## API Surface (selected)
All implemented as App Router route handlers under `src/app/api/*`.
- `auth/[...nextauth]`: NextAuth handler.
- `github/*`: repo/user discovery endpoints.
- `pool-manager/*`: CRUD for pools and env vars through Pool Manager.
- `swarm/*`: polling/validation + stakgraph sub-routes.
- `stakwork/*`: customer/project creation + webhook receiver.
- `tasks/*`: task creation, message posting, title update.
- `workspaces/*`: create workspace, members, insights, validation.
- `upload/presigned-url`: S3 upload URL generation.
- `chat/*`: chat message/response handling.

Most routes guard with session checks and validate inputs via Zod.

---

## UI & Routing
- Workspace-scoped UI lives under `src/app/w/[slug]/*`.
  - `task/[...taskParams]`: AI chat interface with artifacts (code, form, browser, longform), workflow status.
  - `stakgraph/`: configure code graph/swarm/services.
  - `roadmap/`: features and planning.
  - `settings/`: workspace settings.
- Generic pages: onboarding, auth, about, landing, workspace switcher.
- Components are organized by domain (`components/stakgraph`, `components/roadmap`, `components/wizard`, etc.).

State/UX:
- Zustand stores in `src/stores/*` and hooks in `src/hooks/*` (workspace access, Pusher connection, theme, forms, etc.).
- React Query for server state and request lifecycle.
- Providers in `src/providers/*` (session, theme).

---

## Testing
Config: `vitest.config.ts`
- `TEST_SUITE=integration` toggles to integration suite and setup; default is unit.
- Setup files: `src/__tests__/setup-unit.ts`, `src/__tests__/setup-integration.ts`.
- Commands: see `package.json` (unit/integration/coverage). Test DB is managed by Docker via scripts in `scripts/*` and `docker-compose.test.yml`.

---

## Running Locally
See `README.md` for full steps. Summary:
1. `cp env.example .env.local` and fill DB/GitHub/Pusher/S3/service vars.
2. `npm install`
3. `npx prisma generate && npx prisma migrate dev`
4. `npm run dev`

Docker options are available for local DB and app (`docker-compose*.yml`).

---

## Deployment Notes
- `next.config.ts` sets `output: "standalone"` so Docker images can run without dev deps.
- Remote image domains are whitelisted for GitHub avatars and Dicebear.
- Ensure production envs: `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, DB, Pusher, S3, and external service keys.

---

## Observability & Security
- Prisma logs SQL queries in dev; `HttpClient` logs requests/responses.
- `@sentry/nextjs` is present as a dependency (configure DSN to enable).
- Secrets: OAuth tokens and pool keys are encrypted at rest via `EncryptionService`.
- Input validation with Zod in critical routes (e.g., uploads).
- RBAC enforced via `WorkspaceRole` and access helpers/hooks.
- `src/lib/env.ts` fails fast if required service envs are missing.

---

## Common Flows
- **Login**: NextAuth (GitHub) → session established (DB strategy). In dev with `POD_URL`, mock login uses JWT strategy.
- **Workspace lifecycle**: Create workspace → link repository → configure Swarm/Stakgraph → create tasks → collaborate via chat and artifacts.
- **Task chat**: Post a message → persist `ChatMessage` → optional artifact creation → push Pusher events → UI updates in `/w/[slug]/task/...`.
- **File attachment**: Client requests presigned URL → server validates and returns URL + key → client uploads directly to S3 → reference `Attachment` to `ChatMessage`.
- **Pool/Swarm management**: UI calls API → service layer (`PoolManagerService`/`SwarmService`) → external API with Bearer token → DB updates as needed.

---

## Where to Look for X
- Auth config: `src/lib/auth/nextauth.ts`
- Prisma client: `src/lib/db.ts`, schema in `prisma/schema.prisma`
- Env validation: `src/lib/env.ts`
- Real-time: `src/lib/pusher.ts`
- Uploads/S3: `src/app/api/upload/presigned-url/route.ts`, `src/services/s3.ts`
- Services base: `src/lib/base-service.ts`, `src/lib/http-client.ts`
- External services: `src/services/*`
- API routes: `src/app/api/*`
- Workspace UI: `src/app/w/[slug]/*`
- Hooks/Stores: `src/hooks/*`, `src/stores/*`


