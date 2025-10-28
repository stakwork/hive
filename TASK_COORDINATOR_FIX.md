# Task Coordinator Stale Agent Tasks Issue - Root Cause and Fix

## Problem Summary
The `haltStaleAgentTasks` function in the task coordinator was not finding any stale agent tasks, even though tasks existed in the database.

**Update**: The function has been modified to check for `status: "IN_PROGRESS"` instead of `workflowStatus: "PENDING"` to better align with the task lifecycle.

## Root Cause
The issue was that the `mode` field was **not being saved to the database** when tasks were created through the `createTaskWithStakworkWorkflow` function in `src/services/task-workflow.ts`.

### Technical Details

1. **Query Requirements**: The `haltStaleAgentTasks` function searches for tasks matching ALL of these criteria:
   - `mode: "agent"`
   - `status: "IN_PROGRESS"` (changed from `workflowStatus: "PENDING"`)
   - `createdAt` < 24 hours ago
   - `deleted: false`

2. **The Bug**: In `task-workflow.ts`, the `createTaskWithStakworkWorkflow` function:
   - Accepted a `mode` parameter (line 23)
   - Used the mode when calling Stakwork API (line 332)
   - **BUT** never included it in the `task.create()` call (lines 39-51)
   - This meant all tasks were created with the default schema value: `mode: "live"`

3. **Result**: Since no tasks had `mode: "agent"` in the database, the query always returned 0 results.

## The Fix

### File: `src/services/task-workflow.ts`

Added the `mode` field to the task creation data:

```typescript
const task = await db.task.create({
  data: {
    title: title.trim(),
    description: description?.trim() || null,
    workspaceId,
    status,
    priority,
    assigneeId: assigneeId || null,
    repositoryId: repositoryId || null,
    sourceType,
    createdById: userId,
    updatedById: userId,
    mode, // ← ADDED THIS LINE
  },
  // ... rest of the code
});
```

## Verification

### Test Script
A test script has been created at `/workspaces/hive/test-mode-fix.js` that:
- Shows all tasks and their mode values
- Groups tasks by mode
- Counts agent mode tasks
- Simulates the stale task query

Run it with:
```bash
node test-mode-fix.js
```

### Testing the Fix

1. **Create a task with agent mode** through the application
2. **Run the test script** to verify it's saved with `mode: "agent"`
3. **Wait 24+ hours** (or manually update `createdAt` in the database for testing)
4. **Run the task coordinator** to verify it finds and halts the stale task

### Manual Database Check

You can also check directly in the database:

```sql
-- Check task modes
SELECT mode, COUNT(*) FROM "Task" WHERE deleted = false GROUP BY mode;

-- Check for agent tasks
SELECT id, title, mode, status, "created_at" 
FROM "Task" 
WHERE mode = 'agent' AND deleted = false;

-- Check for stale agent tasks (older than 24 hours, IN_PROGRESS)
SELECT id, title, mode, status, "created_at",
       EXTRACT(EPOCH FROM (NOW() - "created_at")) / 3600 as age_hours
FROM "Task" 
WHERE mode = 'agent' 
  AND status = 'IN_PROGRESS'
  AND "created_at" < NOW() - INTERVAL '24 hours'
  AND deleted = false;
```

## Impact

### Before Fix
- All tasks created through `createTaskWithStakworkWorkflow` had `mode: "live"` regardless of the parameter passed
- The `haltStaleAgentTasks` function never found any tasks to halt
- Agent mode tasks that got stuck in IN_PROGRESS state would remain forever

### After Fix
- Tasks are now correctly created with the specified mode
- The `haltStaleAgentTasks` function will properly find and halt stale agent tasks
- Agent mode tasks that are IN_PROGRESS for >24 hours will be automatically halted

## Additional Changes

### Status Field Check
The `haltStaleAgentTasks` function was updated to check `status: "IN_PROGRESS"` instead of `workflowStatus: "PENDING"`:
- This better aligns with the task lifecycle where tasks move to IN_PROGRESS status when work begins
- The `haltTask` function still sets `workflowStatus: "HALTED"` to mark tasks as stopped

## Additional Notes

### Other Task Creation Points
The fix was applied to `createTaskWithStakworkWorkflow`. The API route `/api/tasks` was checked and already correctly saves the mode field (line in `src/app/api/tasks/route.ts`):

```typescript
mode: mode || "live", // Already correct
```

### Default Mode Value
Note that the function has `mode = "default"` as the default parameter value (line 35), which might be unexpected. Consider changing this to:
```typescript
mode = "live", // More explicit default
```

Since "default" is not a recognized mode value in the application (valid modes are "live", "agent", "test").

## Files Modified
- `src/services/task-workflow.ts` - Added `mode` field to task creation, changed default from "default" to "live"
- `src/services/task-coordinator-cron.ts` - Changed stale task detection from `workflowStatus: "PENDING"` to `status: "IN_PROGRESS"`

## Files Created for Testing
- `test-mode-fix.js` - Verification script for the fix
- `TASK_COORDINATOR_FIX.md` - This documentation file
