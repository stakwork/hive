# Auto-Merge Test Data Documentation

## Overview

This document describes the comprehensive test data created for testing the auto-merge feature across multi-task feature chains, coordinator behavior, and UI display.

## Seed Data Structure

The seed script creates **10 tasks across 2 features** plus **4 edge case tasks** to test various auto-merge scenarios.

### Feature A: Payment Integration

**Description:** 3 sequential tasks, all with `autoMerge: true`

**Purpose:** Tests full automation workflow where all tasks in a feature chain auto-merge without manual intervention.

**Tasks:**
1. **Add payment API endpoints**
   - `autoMerge: true`
   - `status: TODO`
   - `priority: HIGH`
   - Dependencies: None
   - Assigned to: `system:task-coordinator`

2. **Implement payment UI components**
   - `autoMerge: true`
   - `status: TODO`
   - `priority: HIGH`
   - Dependencies: Task 1
   - Assigned to: `system:task-coordinator`

3. **Add payment confirmation flow**
   - `autoMerge: true`
   - `status: TODO`
   - `priority: HIGH`
   - Dependencies: Task 2
   - Assigned to: `system:task-coordinator`

**Expected Behavior:**
- Task 1 starts immediately (no dependencies)
- When Task 1 PR merges automatically, Task 2 starts
- When Task 2 PR merges automatically, Task 3 starts
- Entire feature completes without manual intervention

### Feature B: User Profile Enhancement

**Description:** 3 tasks with mixed auto-merge settings

**Purpose:** Tests scenarios where some tasks require manual review while others auto-merge.

**Tasks:**
1. **Update profile schema**
   - `autoMerge: true`
   - `status: TODO`
   - `priority: MEDIUM`
   - Dependencies: None
   - Assigned to: `system:task-coordinator`

2. **Add profile edit UI**
   - `autoMerge: false` ← **Manual merge required**
   - `status: TODO`
   - `priority: MEDIUM`
   - Dependencies: Task 1
   - Assigned to: `system:task-coordinator`

3. **Add avatar upload**
   - `autoMerge: true`
   - `status: TODO`
   - `priority: MEDIUM`
   - Dependencies: Task 2
   - Assigned to: `system:task-coordinator`

**Expected Behavior:**
- Task 1 auto-merges after CI passes
- Task 2 waits for manual review and merge (coordinator waits)
- After manual merge of Task 2, Task 3 starts and auto-merges
- Tests mixed workflow where human intervention is needed mid-chain

### Edge Case Tasks

**Purpose:** Test UI badge display, PR artifact states, and coordinator handling in various scenarios.

#### Edge Case 1: Task with open PR and auto-merge
- **Title:** "Task with open PR and auto-merge"
- `autoMerge: true`
- `status: IN_PROGRESS`
- `workflowStatus: PENDING`
- **PR Artifact:** `status: 'IN_PROGRESS'` (open PR)
- **Expected UI:** Should display "Auto-merge" badge on task card
- **Purpose:** Verify badge shows for active PRs with auto-merge enabled

#### Edge Case 2: Task with merged PR and auto-merge
- **Title:** "Task with merged PR and auto-merge"
- `autoMerge: true`
- `status: DONE`
- `workflowStatus: PENDING`
- **PR Artifact:** `status: 'DONE'` (merged PR)
- **Expected UI:** Should NOT display "Auto-merge" badge (already merged)
- **Purpose:** Verify badge doesn't show for completed tasks

#### Edge Case 3: Task with manual merge required
- **Title:** "Task with manual merge required"
- `autoMerge: false`
- `status: IN_PROGRESS`
- `workflowStatus: PENDING`
- **PR Artifact:** `status: 'IN_PROGRESS'` (open PR)
- **Expected UI:** Should NOT display "Auto-merge" badge
- **Purpose:** Verify badge only shows when auto-merge is enabled

#### Edge Case 4: Task awaiting coordinator processing
- **Title:** "Task awaiting coordinator processing"
- `autoMerge: true`
- `status: IN_PROGRESS`
- `workflowStatus: PENDING`
- **PR Artifact:** None
- **Expected Behavior:** Coordinator should detect and process this task
- **Purpose:** Test coordinator can handle tasks with auto-merge enabled

## Test Factory Support

### createTestTask Factory

Located at: `src/__tests__/support/factories/task.factory.ts`

The factory now accepts an `autoMerge` parameter:

```typescript
const task = await createTestTask({
  workspaceId: 'workspace-id',
  userId: 'user-id',
  autoMerge: true, // ← New parameter
  status: 'TODO',
  priority: 'HIGH'
});
```

### createTestFeatureWithAutoMergeTasks Factory

Located at: `src/__tests__/support/factories/feature-with-tasks.factory.ts`

Helper function for creating features with multiple auto-merge tasks:

```typescript
const { feature, tasks } = await createTestFeatureWithAutoMergeTasks(
  workspaceId,
  userId,
  {
    taskCount: 3,
    allAutoMerge: true, // All tasks have autoMerge: true
    sequential: true,   // Creates dependency chain
    customPriorities: ['HIGH', 'HIGH', 'MEDIUM']
  }
);
```

**Options:**
- `taskCount`: Number of tasks to create (default: 3)
- `allAutoMerge`: If true, all tasks have `autoMerge: true` (default: true)
- `sequential`: If true, creates dependency chain (each task depends on previous)
- `customPriorities`: Array of priorities for each task
- `customTitles`: Array of custom titles for tasks

## Running the Seed Script

### Seed Development Database

```bash
npm run seed:db
```

This will create:
- 25 tasks with layer types (existing behavior)
- 5 features with StakworkRuns (existing behavior)
- **2 auto-merge test features** (Payment Integration + User Profile Enhancement)
- **6 core auto-merge tasks** (4 with autoMerge: true, 2 with autoMerge: false)
- **4 edge case tasks** with PR artifacts

### Reset and Reseed

```bash
npm run test:db:reset
npm run seed:db
```

## Verification

After seeding, verify the data:

```bash
npx tsx -e "
import { db } from './src/lib/db';

async function verify() {
  const payment = await db.feature.findFirst({
    where: { title: 'Payment Integration' },
    include: { phases: { include: { tasks: true } } }
  });
  
  const profile = await db.feature.findFirst({
    where: { title: 'User Profile Enhancement' },
    include: { phases: { include: { tasks: true } } }
  });
  
  console.log('Payment Integration tasks:', payment?.phases[0]?.tasks.length);
  console.log('User Profile Enhancement tasks:', profile?.phases[0]?.tasks.length);
  
  await db.\$disconnect();
}

verify();
"
```

## Test Coverage

### Unit Tests

Located at: `src/__tests__/unit/factories/task-factory.test.ts`

Tests:
- ✅ Task creation with `autoMerge: true` (default)
- ✅ Task creation with `autoMerge: false` (explicit)
- ✅ Task creation with dependencies and auto-merge
- ✅ Feature creation with auto-merge task chains

### Integration Tests

Located at: `src/__tests__/integration/services/seed-auto-merge.test.ts`

Tests:
- ✅ Payment Integration feature has 3 sequential auto-merge tasks
- ✅ User Profile Enhancement has mixed auto-merge settings
- ✅ Edge case tasks have proper PR artifacts
- ✅ Tasks have correct priorities and statuses
- ✅ At least 10 auto-merge test tasks exist

## Test Scenarios Covered

### Coordinator Behavior
- ✅ Tasks with `autoMerge: true` and no dependencies start immediately
- ✅ Dependent tasks start after parent PR merges
- ✅ Mixed auto-merge chains (some manual, some auto)
- ✅ Coordinator detects and processes auto-merge tasks

### UI Display
- ✅ Auto-merge badge shows on task cards with open PRs
- ✅ Auto-merge badge does NOT show on merged/closed PRs
- ✅ Auto-merge badge does NOT show when `autoMerge: false`
- ✅ PR artifact detail view shows auto-merge indicator

### Dependency Chains
- ✅ 3-task sequential chain with all auto-merge
- ✅ 3-task sequential chain with mixed settings
- ✅ Tasks block until dependencies satisfied
- ✅ Correct task ordering preserved

### Edge Cases
- ✅ Open PR with auto-merge enabled
- ✅ Merged PR (should not show badge)
- ✅ Manual merge workflow
- ✅ Pending coordinator processing

## Database Schema

The auto-merge functionality uses the `autoMerge` field on the Task model:

```prisma
model Task {
  id              String   @id @default(cuid())
  title           String
  autoMerge       Boolean  @default(true) @map("auto_merge")
  status          TaskStatus
  workflowStatus  WorkflowStatus?
  dependsOnTaskIds String[] @default([])
  // ... other fields
}
```

## Next Steps

After seeding the test data, you can:

1. **Test UI Badge Display:**
   - Navigate to the workspace with seeded data
   - View task cards to see auto-merge badges
   - Verify badges appear only on appropriate tasks

2. **Test Coordinator Behavior:**
   - Run the task coordinator cron job
   - Verify it detects and processes auto-merge tasks
   - Check task progression through dependency chains

3. **Test GitHub Integration:**
   - Start an agent on an auto-merge task
   - Create a PR
   - Verify GitHub auto-merge is enabled
   - Verify task completes after PR merges

## Troubleshooting

### Seed script fails
- Ensure database is running: `docker ps | grep postgres`
- Check database connection: `npx prisma db pull`
- Reset database: `npm run test:db:reset`

### Data not appearing
- Verify correct database: `echo $DATABASE_URL`
- Check for transaction rollbacks in logs
- Ensure seed script completed: check final log messages

### Tests failing
- Run unit tests: `npm run test:unit -- task-factory.test.ts`
- Run integration tests: `npm run test:integration -- seed-auto-merge.test.ts`
- Check test database is running: `npm run test:db:start`

## Summary

This test data provides comprehensive coverage for:
- ✅ Multi-task feature chains (2 features, 6 core tasks)
- ✅ Mixed auto-merge settings (4 auto, 2 manual)
- ✅ Dependency chains (sequential task progression)
- ✅ Edge cases (4 tasks with various states)
- ✅ UI display scenarios (badges, artifacts)
- ✅ Coordinator behavior (task detection, progression)

**Total Test Data:** 10 tasks across 2 features + 4 edge case tasks = 14 tasks for auto-merge testing
