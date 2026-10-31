# Test Database Setup

This document explains how to set up and use the test database for integration tests.

## Overview

The test database setup provides:
- A separate PostgreSQL database for integration tests
- Docker Compose configuration for easy database management
- Setup and cleanup scripts for test data
- NPM scripts for common test database operations

## Quick Start

### 1. Start the Test Database

```bash
# Start the test database container
npm run test:db:start

# Wait for the database to be ready (about 5-10 seconds)
```

### 2. Set Up Test Data

```bash
# Run migrations and create test data
npm run test:db:setup
```

### 3. Run Integration Tests

```bash
# Run all integration tests against the Docker test database
TEST_DATABASE_URL=postgresql://test:test@localhost:5433/hive_test npm run test:integration

# Or run with the full setup (start DB, setup data, run tests, stop DB)
npm run test:integration:full
```

> **Integration tests only run against a test database.** Before every test,
> `resetDatabase()` deletes every row in every table. The integration setup
> (`src/__tests__/setup/integration.ts`) uses `TEST_DATABASE_URL`, falling back
> to `DATABASE_URL`, and throws before any test runs unless the database
> **name** (the URL path, e.g. `hive_test`) contains `test`. A `test` in the
> user, host or query string doesn't count. Without `TEST_DATABASE_URL`, the
> fallback is usually your dev database from `.env` (`hive_db`), which is refused.

### 4. Clean Up

```bash
# Stop the test database
npm run test:db:stop

# Or clean up test data (keeps DB running)
npm run test:db:cleanup
```

## Configuration

### Environment Variables

Integration tests read `TEST_DATABASE_URL` from the environment (Vitest only
loads `.env`, not `.env.test`), so export it or prefix the command. For reference,
`env.test.example` lists the test values:

```bash
# Test Database URL
TEST_DATABASE_URL="postgresql://test:test@localhost:5433/hive_test"

# Test JWT Secret
JWT_SECRET="test-jwt-secret-key-for-testing-only-64-chars-long"

# Other test-specific variables...
```

### Database Configuration

The test database runs on:
- **Host**: localhost
- **Port**: 5433 (different from main DB to avoid conflicts)
- **Database**: hive_test
- **Username**: test
- **Password**: test

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run test:db:start` | Start test database container |
| `npm run test:db:stop` | Stop test database container |
| `npm run test:db:setup` | Run migrations and create test data |
| `npm run test:db:cleanup` | Remove all test data |
| `npm run test:db:reset` | Clean up and re-setup test data |
| `npm run test:integration:full` | Complete test workflow (start → setup → test → stop) |

## Test Data

The setup script creates the following test data:

### Users
- `test-user-1` (USER role)
- `test-user-2` (ADMIN role)

### Auth Challenges
- `test-challenge-1` (pending)
- `test-challenge-2` (completed)

## Writing Integration Tests

### Basic Test Structure

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { PrismaClient } from '@/generated/prisma'

describe('Your Integration Tests', () => {
  let prisma: PrismaClient

  beforeEach(() => {
    // Use the global prisma instance from setup-integration.ts
    prisma = global.prisma
  })

  it('should test database operations', async () => {
    // Your test code here
    const result = await prisma.user.findMany()
    expect(result).toBeDefined()
  })
})
```

### Test Data Cleanup

The integration test setup automatically:
- Cleans up data before all tests (`beforeAll`)
- Cleans up data after each test (`afterEach`)
- Disconnects from database after all tests (`afterAll`)

### Best Practices

1. **Use the global prisma instance**: Always use `global.prisma` from the setup
2. **Don't modify test data**: The setup creates consistent test data
3. **Clean up after yourself**: If you create test data, clean it up
4. **Use descriptive test names**: Make it clear what each test validates

## Troubleshooting

### Database Connection Issues

```bash
# Check if database is running
docker ps | grep hive-postgres-test

# Check database logs
docker logs hive-postgres-test

# Restart database
npm run test:db:stop
npm run test:db:start
```

### Migration Issues

```bash
# Reset database completely
npm run test:db:stop
docker volume rm hive_postgres_test_data
npm run test:db:start
npm run test:db:setup
```

### Port Conflicts

If port 5433 is already in use:
1. Change the port in `docker-compose.test.yml`
2. Update `TEST_DATABASE_URL` in your environment
3. Restart the test database

## CI/CD Integration

`.github/workflows/test.yml` runs the integration job against a Postgres service
container whose database is named `hive_test`, so it passes the same guard.
Keep a `test` in that name if you change it.

## Security Notes

- The test database uses simple credentials (test/test)
- Test data is isolated from production
- JWT secrets are different from production
- Database is only accessible locally 