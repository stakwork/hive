# Playwright Parallel Testing

This document explains how parallel test execution is configured for Playwright E2E tests in this project.

## Overview

Playwright tests now run in parallel to significantly reduce test execution time. Previously, tests ran serially with a single worker, which was slow but ensured database isolation. With parallel execution enabled, multiple workers can run tests simultaneously.

## Configuration

### Playwright Config (`playwright.config.ts`)

Key configuration changes:

```typescript
{
  workers: process.env.CI ? 2 : undefined, // 2 workers in CI, auto-detect locally
  fullyParallel: true, // Enable parallel execution
  retries: process.env.CI ? 1 : 0, // Retry once in CI
  screenshot: "only-on-failure", // Capture screenshots for debugging
  video: "retain-on-failure", // Record video of failures
}
```

**Worker Count:**
- **Local development**: Auto-detects based on CPU cores (typically 50% of cores)
- **CI environment**: Limited to 2 workers to balance speed and resource usage
- **Override**: Set `workers: 4` to manually specify worker count

### Database Isolation

Each test resets the database before execution via the `test-hooks.ts` fixture:

```typescript
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await resetDatabase(); // Clean slate for each test
    await use(page);
  },
});
```

**Important Notes:**
- Tests share the same database but run with clean state
- Database is reset before each test, not between parallel workers
- Tests should not rely on data from other tests
- This approach works because each test creates its own test data

## Running Tests

### New NPM Scripts

```bash
# Run all E2E tests in parallel
npm run test:e2e

# Run with UI mode (interactive debugging)
npm run test:e2e:ui

# Run in headed mode (see browser)
npm run test:e2e:headed

# Debug mode (pause on each test)
npm run test:e2e:debug
```

### Advanced Options

```bash
# Run specific test file
npx playwright test workspace-delete.spec.ts

# Run with specific worker count
npx playwright test --workers=4

# Run tests matching pattern
npx playwright test --grep "workspace"

# Show test report
npx playwright show-report
```

## Performance Improvements

**Before (Serial Execution):**
- 1 worker
- Tests run one at a time
- ~10-15 minutes for full suite (example)

**After (Parallel Execution):**
- Multiple workers (2-4 depending on system)
- Tests run concurrently
- ~3-5 minutes for full suite (example)

**Expected Speedup:** 2-4x faster depending on:
- Number of CPU cores
- Test suite size
- Database reset time
- Test duration variance

## Troubleshooting

### Tests Fail Intermittently

If tests fail randomly with parallel execution but pass serially:

1. **Check for shared state**: Tests might be depending on data from other tests
2. **Verify database cleanup**: Ensure `resetDatabase()` is clearing all tables
3. **Add test isolation**: Use unique identifiers for test data
4. **Run serially to debug**: `npx playwright test --workers=1`

### Database Connection Issues

If you see connection pool errors:

1. **Increase connection pool size** in your database configuration
2. **Reduce worker count**: `workers: 2` in `playwright.config.ts`
3. **Check database container resources**

### Slow Test Execution

If parallel tests are still slow:

1. **Profile tests**: Run with `--reporter=html` to see test durations
2. **Optimize slow tests**: Break down long tests into smaller ones
3. **Check database reset time**: Optimize `resetDatabase()` function
4. **Use `test.describe.configure({ mode: 'parallel' })`** for specific test files

## Best Practices

### Writing Parallel-Safe Tests

1. **Isolation**: Each test should be independent
   ```typescript
   test('my test', async ({ page }) => {
     // Create your own test data
     const user = await createTestUser();
     const workspace = await createTestWorkspace();
     // ...
   });
   ```

2. **Unique Identifiers**: Use timestamps or UUIDs
   ```typescript
   const uniqueName = `test-workspace-${Date.now()}`;
   ```

3. **Cleanup**: Don't rely on database reset alone
   ```typescript
   test.afterEach(async () => {
     // Optional: explicit cleanup
     await deleteTestData(testId);
   });
   ```

4. **Avoid Race Conditions**: Don't test timing-sensitive scenarios in parallel

### Debugging Tips

1. **Run single test**: `npx playwright test -g "test name"`
2. **Use UI mode**: `npm run test:e2e:ui` for interactive debugging
3. **Check screenshots**: Auto-captured on failure
4. **Review traces**: `npx playwright show-trace trace.zip`

## Configuration Options

### Disable Parallel Execution

If you need to temporarily disable parallel execution:

```typescript
// playwright.config.ts
export default defineConfig({
  workers: 1,
  fullyParallel: false,
  // ...
});
```

### Per-File Configuration

Disable parallel execution for specific test files:

```typescript
// workspace-delete.spec.ts
import { test } from '@/__tests__/e2e/support/fixtures/test-hooks';

test.describe.configure({ mode: 'serial' }); // Run serially

test.describe('Workspace Deletion', () => {
  // Tests run one after another
});
```

### Shard Tests Across CI Jobs

For very large test suites, distribute tests across multiple CI jobs:

```bash
# Job 1
npx playwright test --shard=1/3

# Job 2
npx playwright test --shard=2/3

# Job 3
npx playwright test --shard=3/3
```

## Migration Notes

### Changes Made

1. **playwright.config.ts**: Enabled `fullyParallel: true` and increased `workers`
2. **package.json**: Added new test scripts for E2E testing
3. **test-hooks.ts**: Updated documentation for parallel execution
4. **No database changes**: Existing `resetDatabase()` function works as-is

### Backward Compatibility

The changes are backward compatible:
- Tests still work with serial execution (`workers: 1`)
- No changes required to existing test files
- Database reset mechanism unchanged

## Further Optimization

### Future Improvements

1. **Worker-Specific Databases**: Create separate database schemas per worker
   - Eliminates database reset time
   - Allows true concurrent execution
   - Requires infrastructure changes

2. **Test Data Fixtures**: Pre-seed common test data
   - Reduce setup time in tests
   - Share read-only data across tests

3. **Test Categorization**: Separate fast vs. slow tests
   ```typescript
   // fast.spec.ts - UI tests
   // slow.spec.ts - E2E workflows
   ```

4. **Connection Pooling**: Optimize database connection management

## References

- [Playwright Parallelism Documentation](https://playwright.dev/docs/test-parallel)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Test Isolation Guide](https://playwright.dev/docs/test-isolation)
