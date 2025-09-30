# Tests Directory

This directory contains all test files for the Hive application.

## Structure

```
src/__tests__/
├── assertions/           # Domain-specific test matchers
├── fixtures/             # Test data builders (database-backed and static)
│   ├── user.ts          # createTestUser(), createTestUsers()
│   ├── workspace.ts     # createTestWorkspace(), createTestWorkspaceScenario()
│   ├── swarm.ts         # createTestSwarm()
│   ├── database.ts      # resetDatabase(), cleanup utilities
│   └── static-fixtures.ts # In-memory mock data (mockData.workspace(), etc.)
├── harness/              # Test execution helpers (invokeRoute, etc.)
├── mocks/                # Vitest mock configuration (Prisma client, etc.)
├── setup/                # Vitest setup entrypoints (unit/integration)
├── utils/                # Legacy re-exports (prefer fixtures/)
├── unit/                 # Unit tests
└── integration/          # Integration tests
```

## Test Types

### Unit Tests (`unit/`)
- Test individual functions and components in isolation
- Mock external dependencies
- Fast execution
- Focus on specific functionality

### Integration Tests (`integration/`)
- Test how different parts work together
- May use real database connections
- Test API endpoints and workflows
- Slower but more comprehensive

## Running Tests

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration

# Run tests in watch mode
npm run test:watch
```

## Test Setup

Global hooks live in `setup/global.ts`. Use `setup/unit.ts` and `setup/integration.ts` for suite-specific configuration. Shared builders are exported from `@/__tests__/fixtures`, and the `invokeRoute` helper in `@/__tests__/harness` standardises API route execution in tests.
