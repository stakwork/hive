# E2E Timeout Standardization Migration Guide

## 🎯 **Goal**
Replace all hardcoded timeout values with semantic, centralized constants for better maintainability and consistency.

## 📊 **Before vs After Examples**

### ❌ **Before (Inconsistent & Unclear)**
```typescript
// AuthPage.ts - What does 10000 mean? Why not 5000 or 15000?
await expect(signInButton).toBeVisible({ timeout: 10000 });
await this.page.waitForURL(/\/w\/.*/, { timeout: 10000 });

// TasksPage.ts - Different timeouts for similar operations
await button.isVisible({ timeout: 3000 });     // Quick check
await input.waitFor({ timeout: 10000 });       // Standard wait
await page.waitFor({ timeout: 15000 });        // Navigation

// WorkspaceSettings.ts - Magic numbers everywhere
await expect(modal).toBeVisible({ timeout: 10000 });
await expect(dialog).toBeVisible({ timeout: 10000 });
await page.waitForURL('...', { timeout: 15000 });
```

### ✅ **After (Semantic & Consistent)**
```typescript
// AuthPage.ts - Clear intent, environment-aware
await expect(signInButton).toBeVisible({ timeout: timeoutFor('BUTTON_CLICKABLE') });
await this.page.waitForURL(/\/w\/.*/, { timeout: timeoutFor('SIGN_IN') });

// TasksPage.ts - Consistent semantic timeouts
await button.isVisible({ timeout: timeoutFor('ELEMENT_VISIBLE') });
await input.waitFor({ timeout: timeoutFor('INPUT_READY') });
await page.waitForURL('...', { timeout: timeoutFor('URL_CHANGE') });

// WorkspaceSettings.ts - Clear purpose, easy to adjust
await expect(modal).toBeVisible({ timeout: timeoutFor('MODAL_OPEN') });
await expect(dialog).toBeVisible({ timeout: timeoutFor('MODAL_OPEN') });
await page.waitForURL('...', { timeout: timeoutFor('WORKSPACE_SWITCH') });
```

## 🔧 **Migration Steps**

### **1. Import the timeout utilities**
```typescript
// Add to top of Page Object files
import { timeoutFor, LEGACY_TIMEOUTS } from '../config/timeouts';
```

### **2. Replace hardcoded values with semantic names**
```typescript
// Find all instances of { timeout: NUMBER }
// Replace with appropriate semantic timeout

// Element visibility checks
{ timeout: 3000 }  → { timeout: timeoutFor('ELEMENT_VISIBLE') }
{ timeout: 5000 }  → { timeout: timeoutFor('ELEMENT_VISIBLE') }
{ timeout: 10000 } → { timeout: timeoutFor('ELEMENT_VISIBLE') }

// Page navigation
{ timeout: 10000 } → { timeout: timeoutFor('URL_CHANGE') }
{ timeout: 15000 } → { timeout: timeoutFor('URL_CHANGE') }

// Form operations
{ timeout: 10000 } → { timeout: timeoutFor('FORM_SUBMISSION') }

// Loading states
{ timeout: 30000 } → { timeout: timeoutFor('LOADING_SPINNER') }
```

### **3. Use Legacy Timeouts for gradual migration**
For quick wins without semantic analysis:
```typescript
// Quick migration using legacy values
{ timeout: 3000 }  → { timeout: LEGACY_TIMEOUTS.SHORT }
{ timeout: 10000 } → { timeout: LEGACY_TIMEOUTS.MEDIUM }
{ timeout: 15000 } → { timeout: LEGACY_TIMEOUTS.NAVIGATION }
{ timeout: 30000 } → { timeout: LEGACY_TIMEOUTS.LONG }
```

## 📋 **Migration Checklist**

### **High Priority Files** (Most timeout usage)
- [ ] `AuthPage.ts` - Authentication flows
- [ ] `TasksPage.ts` - Task management
- [ ] `WorkspaceSettingsPage.ts` - Settings operations
- [ ] `DashboardPage.ts` - Main dashboard
- [ ] Helper files in `/support/helpers/`

### **File-by-File Migration Template**
1. **Add imports**:
   ```typescript
   import { timeoutFor } from '../config/timeouts';
   ```

2. **Find and replace patterns**:
   ```bash
   # Find all timeout usages
   grep -n "timeout.*[0-9]" PageObject.ts
   ```

3. **Replace with semantic names**:
   ```typescript
   // Choose appropriate semantic timeout based on operation type
   { timeout: timeoutFor('OPERATION_TYPE') }
   ```

4. **Test the changes**:
   ```bash
   npx playwright test --grep "filename"
   ```

## 🎯 **Available Semantic Timeouts**

### **Element Operations**
- `ELEMENT_VISIBLE` - Basic visibility checks (3s)
- `ELEMENT_HIDDEN` - Waiting for elements to hide (3s)
- `BUTTON_CLICKABLE` - Button interaction ready (3s)
- `INPUT_READY` - Form inputs ready for typing (10s)

### **Page Operations**
- `PAGE_LOAD` - Standard page load (10s)
- `URL_CHANGE` - Navigation between pages (15s)
- `PAGE_TITLE` - Title updates (10s)

### **Form Operations**
- `FORM_SUBMISSION` - Form saves (10s)
- `MODAL_OPEN` - Modal dialogs appearing (10s)
- `MODAL_CLOSE` - Modal dialogs closing (10s)

### **Authentication & Workspace**
- `SIGN_IN` - Login flows (15s)
- `WORKSPACE_CREATION` - Creating workspaces (30s)
- `WORKSPACE_SWITCH` - Changing workspaces (15s)

### **Complex Operations**
- `TASK_CREATION` - Creating new tasks (10s)
- `TASK_LIST_LOAD` - Loading task lists (20s)
- `LOADING_SPINNER` - Any loading state (20s)
- `API_RESPONSE` - API calls (5s)

## 🌍 **Environment Benefits**

The timeout system automatically adjusts for different environments:

```typescript
// Local development: timeoutFor('SIGN_IN') = 15s
// CI environment: timeoutFor('SIGN_IN') = 30s (2x multiplier)
// Docker: timeoutFor('SIGN_IN') = 22.5s (1.5x multiplier)
```

## 🚀 **Quick Migration Script**

Create this bash script for bulk replacement:

```bash
#!/bin/bash
# migrate-timeouts.sh

# Replace common timeout patterns
find src/__tests__/e2e -name "*.ts" -type f -exec sed -i '' \
  -e 's/{ timeout: 3000 }/{ timeout: timeoutFor("ELEMENT_VISIBLE") }/g' \
  -e 's/{ timeout: 10000 }/{ timeout: timeoutFor("ELEMENT_VISIBLE") }/g' \
  -e 's/{ timeout: 15000 }/{ timeout: timeoutFor("URL_CHANGE") }/g' \
  {} \;

echo "✅ Bulk timeout migration completed"
echo "⚠️  Review changes and add imports manually"
echo "🧪 Run tests to verify functionality"
```

## ✅ **Benefits After Migration**

1. **Consistency** - All similar operations use same timeouts
2. **Maintainability** - Change timeouts in one place
3. **Environment Awareness** - Automatic adjustment for CI/Docker
4. **Clarity** - Semantic names explain the purpose
5. **Debugging** - Clear error messages with timeout context
6. **Flexibility** - Easy to adjust for performance changes

## 🎯 **Success Metrics**

- ✅ No more hardcoded timeout numbers in test files
- ✅ All timeout values use semantic constants
- ✅ Tests run reliably in CI environment
- ✅ Easy to adjust timeouts globally when needed
- ✅ Clear timeout documentation for new team members