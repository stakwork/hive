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

### Testing Pool Manager Mock Server

The mock server includes pool manager endpoints that simulate pod availability:

```bash
# Start the mock server
npm run mock-server

# Test pool status endpoint (shows 2 in use, 3 available)
curl http://localhost:3010/pools/test-pool-123

# Test pod workspaces endpoint (returns 5 pods)
curl http://localhost:3010/pools/test-pool-123/workspaces

# Run integration tests for mock server endpoints
npm run test -- pool-status-mock
```

**Pool Status Simulation:**
- 5 total pods running
- 2 pods marked as "in-use" (with repositories)
- 3 pods marked as "available" (no repositories)
- All pods include port mappings for frontend (3000) and graph service (3355)
- Resource usage metrics included for monitoring

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
- `npm run mock-server` - Start mock server for testing (includes pool manager endpoints)
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
