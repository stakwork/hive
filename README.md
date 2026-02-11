# Hive Platform

An AI-first PM toolkit designed to harden codebases and lift test coverage through automated "janitor" workflows. Combines task management, product planning, AI-powered code analysis, and workspace collaboration with deep GitHub integration.

## Features

- 🤖 **AI-Powered Analysis**: Automated code quality checks and test coverage improvements
- 📋 **Task Management**: Comprehensive task tracking with dual status system (user + workflow states)
- 📊 **Product Planning**: Feature → Phase → User Story hierarchy
- 🔄 **GitHub Integration**: Deep GitHub App integration for repository access
- 🏢 **Multi-Tenant**: Workspace-based architecture with fine-grained RBAC
- 🔐 **Secure**: Field-level encryption (AES-256-GCM) for sensitive data
- ⚡ **Real-Time**: Live updates via Pusher integration
- 🧪 **Well-Tested**: Comprehensive unit, integration, and E2E test coverage

## Tech Stack

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui
- **Backend**: Next.js API routes, Prisma ORM, PostgreSQL
- **Authentication**: NextAuth.js (GitHub OAuth + GitHub App)
- **State Management**: Zustand (client), TanStack React Query (server)
- **Testing**: Vitest (unit/integration), Playwright (E2E)
- **AI Integration**: Streaming responses with tool calling support

## Getting Started

### Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- Docker & Docker Compose (recommended)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd hive
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

4. **Start the database**
   ```bash
   docker-compose up -d
   ```

5. **Run migrations**
   ```bash
   npx prisma migrate dev
   ```

6. **Seed the database (optional)**
   ```bash
   npm run seed:auto-seed
   ```

7. **Start the development server**
   ```bash
   npm run dev
   ```

Visit [http://localhost:3000](http://localhost:3000) to see the application.

## Development

### Project Structure

```
src/
├── app/                      # Next.js App Router
│   ├── api/                  # API routes by feature
│   └── w/[slug]/             # Workspace pages
├── components/               # React components
├── lib/                      # Core utilities (auth, encryption, AI, DB)
├── services/                 # External API services
├── hooks/                    # React hooks
├── stores/                   # Zustand state stores
├── types/                    # TypeScript definitions
└── __tests__/                # Test files
```

### Key Commands

```bash
# Development
npm run dev                   # Start dev server
npm run build                 # Build for production
npm run start                 # Start production server

# Database
npx prisma migrate dev        # Create and apply migration
npx prisma studio             # Open Prisma Studio
npm run rotate-keys           # Rotate encryption keys

# Testing
npm run test                  # Run all tests
npm run test:unit             # Unit tests only
npm run test:integration      # Integration tests only
npx playwright test           # E2E tests
npx playwright test --ui      # E2E with UI mode

# Test Database
npm run test:db:start         # Start test database
npm run test:db:stop          # Stop test database
npm run test:db:reset         # Reset test database

# Code Quality
npm run lint                  # Run ESLint
npm run format                # Format with Prettier
```

### Database Migrations

**IMPORTANT**: Always create migrations when modifying `schema.prisma`:

```bash
npx prisma migrate dev --name <description>
```

Never modify the schema without creating a migration.

## Authentication

Hive supports multiple authentication methods:

1. **GitHub OAuth**: Standard user authentication
2. **GitHub App**: Repository access (install the GitHub App)
3. **Mock Auth**: Development mode when `POD_URL` is set

### GitHub App Setup

1. Create a GitHub App in your GitHub account/organization
2. Set the following environment variables:
   ```
   GITHUB_APP_ID=your_app_id
   GITHUB_APP_PRIVATE_KEY=your_private_key
   GITHUB_APP_SLUG=your_app_slug
   ```
3. Install the app on your repositories

## Permission System

Role hierarchy (highest to lowest):
- **OWNER** (6): Full workspace control
- **ADMIN** (5): User and workspace management
- **PM** (4): Product and task management
- **DEVELOPER** (3): Code and task contributions
- **STAKEHOLDER** (2): Product planning input
- **VIEWER** (1): Read-only access

Use the `useWorkspaceAccess()` hook to check permissions:

```typescript
const { canWrite, canAdmin, permissions } = useWorkspaceAccess();

if (canWrite) {
  // Show edit buttons
}

if (permissions.canManageRepositories) {
  // Show repository management
}
```

## Testing

### Test Organization

- **Unit Tests**: `src/__tests__/unit/`
- **Integration Tests**: `src/__tests__/integration/`
- **E2E Tests**: `src/__tests__/e2e/`

### E2E Testing Guidelines

- Always use `AuthPage.signInWithMock()` for authentication
- Use `selectors.ts` for all selectors
- Use Page Object Models for interactions
- Add `data-testid` attributes to components for testing

### Test Database

The project uses a separate test database. Start it with:

```bash
npm run test:db:start
```

## Cron Jobs

Three automated jobs run via Vercel:

1. **Janitors** (`/api/cron/janitors`): Runs code analysis on enabled workspaces
2. **Pod Repair** (`/api/cron/pod-repair`): Monitors and repairs workspace pods
3. **Task Coordinator** (`/api/cron/task-coordinator`): Coordinates task dependencies

Secured with `CRON_SECRET` environment variable.

## Feature Flags

Environment-based feature flags with role access control. Use the `useFeatureFlag()` hook:

```typescript
const isEnabled = useFeatureFlag('FEATURE_NAME');
```

Client-side flags require `NEXT_PUBLIC_` prefix. See `/docs/feature-flags.md` for details.

## Security

- **Field-level encryption**: Sensitive data encrypted with AES-256-GCM
- **Token encryption**: GitHub tokens and API keys encrypted in database
- **Sanitized logging**: Automatic removal of sensitive data from logs
- **Environment validation**: Required environment variables validated at startup

## Deployment

### Environment Variables

Key variables (see `env.example` for complete list):

```env
# Database
DATABASE_URL=postgresql://...

# Authentication
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_secret
JWT_SECRET=your_jwt_secret

# GitHub
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
GITHUB_APP_SLUG=your_app_slug

# Encryption
TOKEN_ENCRYPTION_KEY=your_encryption_key
TOKEN_ENCRYPTION_KEY_ID=your_key_id

# External Services
STAKWORK_API_KEY=your_stakwork_key
POOL_MANAGER_API_KEY=your_pool_manager_key
PUSHER_APP_ID=your_pusher_app_id
```

### Vercel Deployment

1. Push your code to GitHub
2. Import project in Vercel
3. Add environment variables
4. Deploy

The `vercel.json` configuration includes cron job definitions.

## Contributing

1. Create a feature branch
2. Make your changes
3. Write/update tests
4. Run `npm run lint` and `npm run format`
5. Create a pull request

### Code Style

- ESLint + Prettier + TypeScript strict mode
- Components should own their data (avoid prop drilling)
- Always create directories with `index.tsx` for new components
- Use async/loading states instead of `setTimeout`

## Documentation

- `/docs/` - Additional documentation
- `.cursorrules/` - Development rules for Cursor AI
- Architecture overview in project summary

## License

[Add your license here]

## Support

[Add support information here]
