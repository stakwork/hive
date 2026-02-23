## About

Hive is an AI-first PM toolkit built with Next.js 15 (App Router) and PostgreSQL (via Prisma).

- The frontend uses React 19, Tailwind CSS, and shadcn/ui components
- Auth is handled by NextAuth.js with GitHub OAuth
- API routes live in `src/app/api/`; pages/UI live in `src/app/`
- Database schema is in `prisma/schema.prisma`
- Tests: `npm run test:unit` (Vitest) and `npm run test:integration`

## Guidelines

If you add a new route make sure to check `src/config/middleware.ts` in case you need to update the `ROUTE_POLICIES`.

## Context Providers

Global providers are mounted in `src/app/layout.tsx` in this nesting order:

- **ThemeProvider** (`src/providers/theme-provider.tsx`) — dark/light/system theme state. Hook: `useTheme()`
- **SessionProvider** (`src/providers/SessionProvider.tsx`) — NextAuth session/user identity. Hook: `useSession()`
- **WorkspaceProvider** (`src/contexts/WorkspaceContext.tsx`) — current workspace (`WorkspaceWithAccess` including `repositories`, slug, id, role), all user workspaces, task notification counts, and actions (switch, refresh, update). Hook: `useWorkspace()` (`src/hooks/useWorkspace.ts`)
- **QueryProvider** (`src/providers/QueryProvider.tsx`) — TanStack React Query client. Hooks: `useQuery()`, `useMutation()`, etc.
- **ModalProvider** (`src/components/modals/ModlaProvider.tsx`, mounted via `src/app/ModalClient.tsx`) — imperative modal launcher (`open(name, props)`). Hook: `useModal()`

## Key Prisma Models

Schema: `prisma/schema.prisma`

- **User** — auth identity (NextAuth). Has `Account`/`Session`/`GitHubAuth` for OAuth. Owns workspaces, assigned to tasks/features.
- **Workspace** — top-level org unit. Has an owner (`User`), members (`WorkspaceMember` with `WorkspaceRole`), repositories, a `Swarm`, tasks, features, janitor config, whiteboards, API keys, and integrations (Vercel, Sphinx).
- **WorkspaceMember** — join table: user + workspace + role (`OWNER | ADMIN | PM | DEVELOPER | STAKEHOLDER | VIEWER`).
- **Repository** — GitHub repo linked to a workspace. Tracks branch, sync status (`PENDING | SYNCED | FAILED`), webhook config, and sync toggles (codeIngestion, docs, mocks, embeddings). A workspace can have multiple repos.
- **Swarm** — 1:1 with workspace. Infrastructure config: pool/pod state, swarm URL, API keys, environment variables, agent settings, auto-learn toggle.
- **Pod** — instances within a swarm/pool. Tracks status, credentials, health, usage, and recreation flags.
- **Task** — work item in a workspace. Optionally linked to a `Feature`, `Phase`, `Repository`. Has assignee, status, priority, workflow status, agent URL/credentials, chat messages, artifacts, deployments, and agent logs.
- **ChatMessage** — message in a task conversation. Has role (USER/ASSISTANT), artifacts, and attachments.
- **Artifact** — rich content attached to a chat message (code, form, browser, PR, diff, graph, etc.).
- **Feature** — roadmap feature. Has brief, requirements, architecture, user stories, phases, tasks, and a whiteboard.
- **Phase** — ordered stage within a feature. Contains tasks.
- **JanitorConfig** — per-workspace toggles for automated code quality janitors (unit tests, security, refactoring, PR monitoring, etc.).
- **JanitorRun / JanitorRecommendation** — execution records and resulting recommendations from janitor sweeps.
- **Whiteboard** — Excalidraw canvas linked to a workspace (optionally to a feature). Stores elements/appState/files as JSON.
- **SourceControlOrg / SourceControlToken** — GitHub App installation and per-user encrypted tokens.
- **StakworkRun / AgentLog** — AI generation run tracking and agent trace logs.

## Fundamental Principle

For non-trivial changes, pause and ask: "is there a more elegant way?"
