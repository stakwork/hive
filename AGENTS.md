# Repository Guidelines

## Project Structure & Module Organization
Core code lives in `src/app` (App Router routes and API handlers) with shared UI in `src/components`. Domain logic is split across `src/lib`, `src/services`, and `src/utils`; client state stores sit in `src/stores`. Tests live in `src/__tests__/{unit,integration,e2e}` with helpers in `src/__tests__/utils`. Database schema and generated client files stay in `prisma/`, with migrations committed alongside code. Static assets reside in `public/`, documentation in `docs/`, and automation scripts in `scripts/`. Configure secrets by copying `.env.example` to `.env.local`, plus `.env.test.example` for integration runs.

## Build, Test, and Development Commands
Use `npm run dev` for the Turbopack dev server and `npm run build` + `npm run start` to validate production output. `npm run lint` enforces ESLint, while `npm run format` applies Prettier. `npm run test` executes the Vitest suite; append `:watch` or `:coverage` as needed. Manage the Dockerised Postgres for integration tests with `npm run test:db:start`, `...:setup`, and `...:stop`. Regenerate JWT material with `npm run setup` when adding or rotating secrets.

## Coding Style & Naming Conventions
Write TypeScript-first code with strict types and `zod` validation for user inputs. Components are PascalCase (`src/components/CreateWorkspaceDialog.tsx`), hooks use `use*`, utilities stay camelCase. Prefer React Server Components and gate client logic with `"use client"`. Keep Tailwind classes declarative; reuse shadcn components before layering custom CSS. Let ESLint and Prettier drive indentation (2 spaces), trailing commas, and import order. Never edit generated files under `src/generated`.

## Testing Guidelines
Place unit specs in the matching `src/__tests__/unit/<area>` folder and mirror API/service coverage under `src/__tests__/integration`. Name specs for the behavior under test (e.g. `workspace-service.spec.ts`). Run `npm run test:integration:full` before merging schema or data changes, and capture new migrations with `npx prisma migrate dev`. Playwright e2e cases live in `src/__tests__/e2e`; invoke them via `npx playwright test` when workflows shift. Maintain or improve coverage rather than removing assertions.

## Commit & Pull Request Guidelines
Follow conventional commits (`feature:`, `fix:`, `refactor:`) as in the existing history. Keep pull requests scoped, describe the problem, solution, and test evidence, and link the relevant issue. Attach screenshots or terminal snippets for UX or CLI changes. Document schema updates with `npx prisma migrate diff` output and call out new environment variables or background jobs in the PR body.
