## About

Hive is an AI-first PM toolkit built with Next.js 15 (App Router) and PostgreSQL (via Prisma).

- The frontend uses React 19, Tailwind CSS, and shadcn/ui components
- Auth is handled by NextAuth.js with GitHub OAuth
- API routes live in `src/app/api/`; pages/UI live in `src/app/`
- Database schema is in `prisma/schema.prisma`
- Tests: `npm run test:unit` (Vitest) and `npm run test:integration`

## Guidelines

If you add a new route make sure to check `src/config/middleware.ts` in case you need to update the `ROUTE_POLICIES`.

## Fundamental Principle

For non-trivial changes, pause and ask: "is there a more elegant way?"
