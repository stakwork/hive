# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Development
- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
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
- `npm run test:db:start` - Start test database
- `npm run test:db:stop` - Stop test database
- `npm run test:db:setup` - Setup test database
- `npm run test:db:cleanup` - Cleanup test database
- `npm run test:db:reset` - Reset test database

## Architecture Overview

### Tech Stack
- **Frontend**: Next.js 15 with App Router, React 19, TypeScript
- **Styling**: Tailwind CSS v4, shadcn/ui components with Radix UI
- **Backend**: Next.js API routes, Prisma ORM, PostgreSQL
- **Authentication**: NextAuth.js with GitHub OAuth
- **Testing**: Vitest with Testing Library
- **Forms**: React Hook Form + Zod validation
- **State Management**: TanStack React Query for server state

### Key Directories

#### `/src/app` - Next.js App Router
- API routes for authentication, GitHub, pool management, Stakwork, and workspace operations
- Page components organized by workspace slug (`/w/[slug]/*`)
- Authentication pages and onboarding flow

#### `/src/components` - React Components
- `ui/` - shadcn/ui components (Button, Dialog, Input, etc.)
- `wizard/` - Multi-step wizard components for workspace setup
- `stakgraph/` - Components for stakgraph integration and forms
- `roadmap/` - Product roadmap management components
- `onboarding/` - User onboarding components

#### `/src/lib` - Core Utilities
- `auth/` - NextAuth.js configuration and workspace resolution
- `db.ts` - Prisma client instance
- `utils.ts` - General utility functions
- `service-factory.ts` - Service factory for external API integrations

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
- **Users & Authentication**: NextAuth.js tables, GitHub OAuth integration
- **Workspaces**: Multi-tenant workspace system with role-based access
- **Infrastructure**: Swarms (deployment infrastructure) and repositories
- **Product Management**: Products → Features → User Stories → Tasks hierarchy
- **Roadmap Management**: Roadmaps with time-based planning
- **Communication**: Polymorphic comment system

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
- Uses NextAuth.js with GitHub OAuth provider
- Workspace access is resolved through middleware
- Session management integrated with Prisma adapter

### Working with Workspaces
- All workspace pages use `/w/[slug]/*` pattern
- Use `useWorkspace()` for workspace data and operations
- Use `useWorkspaceAccess()` for permission checks
- Workspace context is provided by `WorkspaceProvider`

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
Required environment variables:
- `DATABASE_URL` - PostgreSQL connection string
- `NEXTAUTH_URL` - Application URL
- `NEXTAUTH_SECRET` - Session encryption secret
- `GITHUB_CLIENT_ID` - GitHub OAuth client ID
- `GITHUB_CLIENT_SECRET` - GitHub OAuth client secret

### Code Style
- Uses ESLint with Next.js configuration
- Tailwind CSS for styling
- TypeScript strict mode enabled
- Prettier for code formatting

## Next.js Best Practices

### Server-Side Architecture
- **API Routes are Serverless Functions**: Remember that Next.js API routes run as serverless functions, not traditional servers
  - Keep functions stateless and lightweight
  - Avoid long-running processes or persistent connections
  - Use connection pooling for databases (Prisma handles this automatically)
  - Cache expensive operations appropriately

### Performance & Optimization
- **Image Optimization**: Always use `next/image` for images
- **Font Optimization**: Use `next/font` for Google Fonts and local fonts (already implemented)
- **Bundle Analysis**: Use `@next/bundle-analyzer` to monitor bundle sizes
- **Core Web Vitals**: Monitor and optimize LCP, FID, and CLS metrics

### App Router Specific Practices
- **Server vs Client Components**: Default to Server Components, use Client Components only when needed
  - Add `'use client'` directive only for components that need browser APIs, event handlers, or hooks
  - Server Components are better for SEO, performance, and bundle size
- **Loading & Error States**: Use `loading.tsx` and `error.tsx` files for route-level states
- **Parallel Routes**: Use `@folder` notation for complex layouts with multiple data sources
- **Route Groups**: Use `(group)` folders to organize routes without affecting URL structure

### Data Fetching Best Practices
- **Prefer Server-Side Data Fetching**: Use Server Components for initial data loading
- **React Query for Client State**: Use TanStack Query for client-side caching and mutations (already in use)
- **Streaming with Suspense**: Implement streaming for better perceived performance
- **Avoid fetch() in Client Components**: Use React Query or SWR for client-side data fetching

### Caching Strategy
- **Understand Next.js Caching**: Be aware of Router Cache, Full Route Cache, Request Memoization, and Data Cache
- **Revalidation Patterns**: Use `revalidatePath()` and `revalidateTag()` for targeted cache invalidation
- **Static Generation**: Use `generateStaticParams()` for dynamic routes when possible
- **ISR (Incremental Static Regeneration)**: Consider for frequently updated but cacheable content

### Security Practices
- **Environment Variables**: Use `NEXT_PUBLIC_` prefix only for client-exposed variables
- **API Route Protection**: Always validate authentication/authorization in API routes (pattern already implemented)
- **CSRF Protection**: Be aware that API routes need CSRF protection for state-changing operations
- **Content Security Policy**: Implement CSP headers in `next.config.js`

### Development Workflow
- **Type Safety**: Leverage TypeScript with `next.config.js` type checking (already enabled)
- **Route Type Safety**: Use generated types for dynamic routes when possible
- **Development vs Production**: Remember differences in behavior (caching, error handling, etc.)

### Code Organization
- **Colocation**: Keep related components, hooks, and utilities close to where they're used
- **Route Handlers**: Use the new App Router route handler format (`GET`, `POST` functions) - already implemented
- **Error Boundaries**: Implement error boundaries for better error handling

### Build & Deployment
- **Build Analysis**: Regularly check bundle size and identify heavy dependencies
- **Edge Runtime**: Consider Edge Runtime for lightweight API routes
- **Static Exports**: Use `output: 'export'` for static hosting when appropriate (currently using 'standalone')
- **Environment-Specific Configs**: Use different configs for development, staging, and production

### Monitoring & Debugging
- **Performance Monitoring**: Use `next/dynamic` for code splitting heavy components
- **Error Tracking**: Implement error tracking with Sentry or similar
- **Logging**: Use structured logging for serverless functions

### Project-Specific Patterns

#### Multi-Tenant Workspace Pattern
- Always resolve workspace context in middleware or server components before route access
- Use workspace slug in URLs consistently (`/w/[slug]/*`)
- Implement workspace-scoped queries in all database operations
- Cache workspace permissions to avoid repeated database calls
- Use `useWorkspace()` for workspace data and operations
- Use `useWorkspaceAccess()` for permission checks in components

#### Service Integration Pattern
- External API calls should always be server-side when possible
- Use service factory pattern for consistent API client management (already implemented)
- Implement retry logic and error handling for external services
- Cache external API responses appropriately
- Services: `StakworkService`, `PoolManagerService`

#### Permission-Based Rendering
- Check permissions on both server and client side for security
- Use role-based component rendering patterns (already implemented)
- Implement progressive enhancement for different permission levels
- Role hierarchy: `OWNER` > `ADMIN` > `PM` > `DEVELOPER` > `STAKEHOLDER` > `VIEWER`
