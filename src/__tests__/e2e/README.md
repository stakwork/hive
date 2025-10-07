# E2E Test Suite

End-to-end testing for Hive Platform using Playwright.

## Directory Structure

```
src/__tests__/e2e/
├── specs/                      # Test specifications organized by feature
│   ├── auth/                   # Authentication tests
│   ├── dashboard/              # Dashboard tests
│   ├── tasks/                  # Task management tests
│   ├── insights/               # Insights & janitor tests
│   ├── onboarding/             # Onboarding wizard tests
│   └── workspace/              # Workspace settings tests
├── support/                    # Shared test utilities
│   ├── fixtures/               # Test fixtures & setup
│   │   ├── auth.ts            # Authentication helpers
│   │   ├── workspace.ts       # Workspace helpers
│   │   └── selectors.ts       # Centralized selectors
│   ├── page-objects/           # Page Object Models
│   │   ├── AuthPage.ts
│   │   ├── DashboardPage.ts
│   │   ├── TasksPage.ts
│   │   ├── InsightsPage.ts
│   │   └── index.ts
│   └── helpers/                # Utility functions
│       ├── navigation.ts       # Navigation helpers
│       ├── assertions.ts       # Assertion helpers
│       ├── waits.ts           # Wait helpers
│       └── index.ts
└── README.md                   # This file
```

## Running Tests

### All tests
```bash
npx playwright test
```

### Specific test file
```bash
npx playwright test src/__tests__/e2e/specs/auth/authentication-flow.spec.ts
```

### By category
```bash
npx playwright test src/__tests__/e2e/specs/auth/
npx playwright test src/__tests__/e2e/specs/dashboard/
npx playwright test src/__tests__/e2e/specs/tasks/
```

### With UI mode
```bash
npx playwright test --ui
```

### In headed mode (see browser)
```bash
npx playwright test --headed
```

### Generate test report
```bash
npx playwright show-report
```

## Writing Tests

### 1. Use Page Object Models

Page Objects encapsulate page interactions and make tests more maintainable.

**Good:**
```typescript
import { AuthPage, DashboardPage } from '../../support/page-objects';

test('should navigate to dashboard', async ({ page }) => {
  const authPage = new AuthPage(page);
  const dashboardPage = new DashboardPage(page);

  await authPage.goto();
  await authPage.signInWithMock();
  await dashboardPage.waitForLoad();
});
```

**Bad:**
```typescript
test('should navigate to dashboard', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await page.locator('[data-testid="mock-signin-button"]').click();
  await page.waitForURL(/\/w\/.*/);
  await page.locator('h1:has-text("Dashboard")').waitFor({ state: 'visible' });
});
```

### 2. Use Centralized Selectors

Always use selectors from `support/fixtures/selectors.ts` instead of hardcoding.

**Good:**
```typescript
import { selectors } from '../../support/fixtures/selectors';

await page.locator(selectors.navigation.settingsButton).click();
await expect(page.locator(selectors.pageTitle.dashboard)).toBeVisible();
```

**Bad:**
```typescript
await page.locator('button:has-text("Settings")').click();
await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible();
```

### 3. Prefer data-testid Attributes

When adding new tests, use `data-testid` attributes in components for stable selectors.

**Add to component:**
```tsx
<Button data-testid="save-button" onClick={handleSave}>
  Save
</Button>
```

**Use in test:**
```typescript
await page.locator('[data-testid="save-button"]').click();
```

### 4. Use Helper Functions

Leverage helper functions for common patterns.

```typescript
import { assertVisible, waitForElement } from '../../support/helpers';

await assertVisible(page, selectors.pageTitle.dashboard);
await waitForElement(page, selectors.tasks.taskCard);
```

### 5. Test Structure Best Practices

```typescript
import { test, expect } from '@playwright/test';
import { AuthPage, TasksPage } from '../../support/page-objects';
import { selectors } from '../../support/fixtures/selectors';

test.describe('Feature Name', () => {
  // Setup before each test
  test.beforeEach(async ({ page }) => {
    // Common setup
  });

  test('should do something specific', async ({ page }) => {
    // Arrange: Set up test data
    const authPage = new AuthPage(page);

    // Act: Perform actions
    await authPage.goto();
    await authPage.signInWithMock();

    // Assert: Verify results
    await authPage.verifyAuthenticated();
  });
});
```

## Page Object Model Pattern

### Creating a New Page Object

```typescript
import { Page, expect } from '@playwright/test';
import { selectors } from '../fixtures/selectors';

export class MyPage {
  constructor(private page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/my-route');
    await this.waitForLoad();
  }

  async waitForLoad(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.element)).toBeVisible({ timeout: 10000 });
  }

  async clickButton(): Promise<void> {
    await this.page.locator('[data-testid="my-button"]').click();
  }

  async verifyContent(text: string): Promise<void> {
    await expect(this.page.locator(`text=${text}`)).toBeVisible();
  }
}
```

## Adding New data-testid Attributes

When you need a new selector, add `data-testid` to the component first:

1. **Add to component:**
```tsx
// src/components/MyComponent.tsx
export function MyComponent() {
  return (
    <div data-testid="my-component">
      <button data-testid="my-button">Click me</button>
    </div>
  );
}
```

2. **Add to selectors.ts:**
```typescript
// src/__tests__/e2e/support/fixtures/selectors.ts
export const selectors = {
  // ...
  myComponent: {
    container: '[data-testid="my-component"]',
    button: '[data-testid="my-button"]',
  },
};
```

3. **Use in tests:**
```typescript
await page.locator(selectors.myComponent.button).click();
```

## Debugging Tests

### 1. Use Playwright Inspector
```bash
PWDEBUG=1 npx playwright test
```

### 2. Add Screenshots
```typescript
await page.screenshot({ path: 'debug.png' });
```

### 3. Pause Execution
```typescript
await page.pause();
```

### 4. View Test Trace
```bash
npx playwright show-trace trace.zip
```

## CI/CD Integration

Tests are configured to run in CI with:
- 2 retries on failure
- 1 worker (sequential execution)
- HTML and list reporters
- Screenshots and videos on failure

## Test Coverage Goals

- **Phase 1 (Complete)**: Critical paths
  - Authentication flow
  - Task creation and chat
  - Dashboard loading
  - Onboarding wizard
  - Insights recommendations

- **Phase 2 (Planned)**: Core features
  - Workspace switching
  - Task list operations
  - Repository connection
  - Member management
  - Stakgraph configuration

- **Phase 3 (Planned)**: Enhanced coverage
  - Learn/chat functionality
  - GitHub App flow
  - Janitor configuration
  - Coverage visualization
  - Workspace deletion

## Writing Better Tests

### Example Comparison

**Without Page Objects:**
```typescript
test('basic test', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await page.locator('[data-testid="mock-signin-button"]').click();
  await page.waitForURL(/\/w\/.*/);
  const settingsButton = page.locator('button:has-text("Settings")');
  await settingsButton.click();
});
```

**With Page Objects (Recommended):**
```typescript
import { AuthPage, DashboardPage } from '../../support/page-objects';

test('improved test', async ({ page }) => {
  const authPage = new AuthPage(page);
  const dashboardPage = new DashboardPage(page);

  await authPage.goto();
  await authPage.signInWithMock();
  await dashboardPage.goToSettings();
});
```

## Contributing

When adding new E2E tests:

1. Use the new directory structure
2. Create or update Page Objects as needed
3. Add `data-testid` to components
4. Update selectors.ts
5. Follow the test structure best practices
6. Add tests to appropriate spec directory
