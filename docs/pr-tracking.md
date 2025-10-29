# PR Tracking for Agent Mode Tasks

## Overview

This feature automatically tracks Pull Requests (PRs) created by agent mode tasks and marks tasks as completed when their PRs are merged. This eliminates the need for manual task completion and provides a seamless workflow for agent-driven development.

## How It Works

### 1. PR Creation and Storage

When a commit is made in agent mode (`/api/agent/commit`):

1. The system creates PR URLs based on the repository and branch
2. The PR URL and branch name are stored in the task record:
   - `prUrl`: The GitHub PR URL (e.g., `https://github.com/owner/repo/pull/new/branch-name`)
   - `prBranch`: The branch name (e.g., `feature/add-login`)
   - `prMergedAt`: Initially `null`, set when PR is merged

### 2. Automated PR Tracking

A cron job runs periodically (`/api/cron/pr-tracking`) to:

1. **Query** for agent tasks with open PRs:
   - Tasks in `agent` mode
   - With non-null `prUrl` and `prBranch`
   - Not yet marked as merged (`prMergedAt` is `null`)
   - In `IN_PROGRESS` or `TODO` status

2. **Check** PR status via GitHub API:
   - Searches for PRs with the stored branch name
   - Checks if the PR has been merged (`merged_at` field)

3. **Update** tasks when PRs are merged:
   - Sets `status` to `DONE`
   - Records `prMergedAt` timestamp
   - Sets `workflowStatus` to `COMPLETED`
   - Sets `workflowCompletedAt` to the merge timestamp

## Database Schema

Three new fields were added to the `Task` model:

```prisma
model Task {
  // ... existing fields ...
  
  // PR tracking for agent tasks
  prUrl         String?   @map("pr_url")         // Pull Request URL
  prBranch      String?   @map("pr_branch")      // Branch name associated with PR
  prMergedAt    DateTime? @map("pr_merged_at")   // When PR was merged
  
  // ... existing fields ...
}
```

## Configuration

### Environment Variables

- `PR_TRACKING_ENABLED`: Set to `"false"` to disable PR tracking (default: `true`)

### Cron Schedule

Set up a cron job to call `/api/cron/pr-tracking` at your desired interval. Recommended: every 5-15 minutes.

Example Vercel cron configuration (`vercel.json`):

```json
{
  "crons": [
    {
      "path": "/api/cron/pr-tracking",
      "schedule": "*/10 * * * *"
    }
  ]
}
```

## API Endpoints

### GET `/api/cron/pr-tracking`

Executes PR tracking for all eligible agent tasks.

**Response:**
```json
{
  "success": true,
  "tasksProcessed": 5,
  "tasksCompleted": 2,
  "errorCount": 0,
  "errors": [],
  "timestamp": "2024-10-28T12:00:00.000Z"
}
```

**Response Fields:**
- `success`: `true` if no errors occurred
- `tasksProcessed`: Number of tasks checked
- `tasksCompleted`: Number of tasks marked as DONE
- `errorCount`: Number of errors encountered
- `errors`: Array of error objects with `taskId` and `error` message
- `timestamp`: ISO timestamp of execution

## Service Layer

### `executePRTracking()`

Located in `/src/services/pr-tracking-cron.ts`

This function:
1. Queries for eligible tasks
2. For each task:
   - Parses the PR URL to extract owner/repo
   - Fetches GitHub access token for the workspace
   - Calls GitHub API to check PR merge status
   - Updates task if PR is merged
3. Returns execution results with statistics

**Example Usage:**

```typescript
import { executePRTracking } from "@/services/pr-tracking-cron";

const result = await executePRTracking();
console.log(`Completed ${result.tasksCompleted} of ${result.tasksProcessed} tasks`);
```

## Error Handling

The system gracefully handles various error scenarios:

### Skipped Tasks (no error recorded)
- Tasks without a source control org
- Tasks with no PR found on GitHub
- Tasks where GitHub API returns non-200 status

### Recorded Errors
- Invalid PR URLs that can't be parsed
- Missing GitHub access tokens
- Database errors when updating tasks
- GitHub API request failures

### Critical Errors
- Database connection failures
- System-level errors

All errors are logged and included in the execution result for monitoring.

## Workflow Example

1. **User creates agent task**
   - Task created in `agent` mode
   - Task status: `TODO` → `IN_PROGRESS`

2. **Agent makes changes and commits**
   - POST to `/api/agent/commit`
   - System stores `prUrl` and `prBranch` in task
   - User sees PR URL in UI

3. **User creates and reviews PR**
   - User clicks PR URL
   - Creates PR on GitHub
   - Reviews and approves changes

4. **PR is merged**
   - User or CI merges the PR on GitHub

5. **Cron job detects merge**
   - Next cron execution (e.g., 10 minutes later)
   - System queries GitHub API
   - Detects PR merge
   - Updates task: `status: DONE`, `prMergedAt: <timestamp>`

6. **Task automatically marked as complete**
   - Task appears as completed in UI
   - Workflow status: `COMPLETED`
   - No manual intervention needed

## Testing

Comprehensive unit tests are provided in `/src/__tests__/unit/services/pr-tracking-cron.test.ts`

Run tests with:
```bash
npm test pr-tracking-cron
```

### Test Coverage

- ✅ Marks tasks as DONE when PRs are merged
- ✅ Doesn't mark tasks when PRs are not merged
- ✅ Handles case when no PR exists for branch
- ✅ Processes multiple tasks with different PR states
- ✅ Handles GitHub API errors gracefully
- ✅ Handles missing GitHub tokens
- ✅ Handles invalid PR URLs
- ✅ Handles missing source control org
- ✅ Handles database errors when updating tasks
- ✅ Handles critical execution errors
- ✅ Only targets agent mode tasks
- ✅ Only targets tasks with non-null PR data
- ✅ Only targets un-merged PRs
- ✅ Excludes deleted tasks

## Monitoring

Monitor the PR tracking system using:

1. **Cron endpoint response**
   - Check `success`, `tasksCompleted`, and `errors` fields
   - Set up alerting for `success: false` responses

2. **Application logs**
   - Look for `[PRTracking]` prefix
   - Track execution duration and task counts

3. **Database queries**
   ```sql
   -- Find recently merged PRs
   SELECT id, title, pr_branch, pr_merged_at, status
   FROM tasks
   WHERE mode = 'agent' 
     AND pr_merged_at IS NOT NULL
   ORDER BY pr_merged_at DESC
   LIMIT 10;
   
   -- Find tasks with open PRs
   SELECT id, title, pr_branch, pr_url, status
   FROM tasks
   WHERE mode = 'agent'
     AND pr_url IS NOT NULL
     AND pr_merged_at IS NULL
     AND status IN ('IN_PROGRESS', 'TODO')
   ORDER BY created_at DESC;
   ```

## Security Considerations

1. **GitHub Token Access**
   - Uses workspace-level GitHub App tokens
   - Tokens never exposed to frontend
   - Tokens are workspace-specific

2. **PR Validation**
   - Only processes PRs from configured repositories
   - Validates PR URLs before parsing
   - Gracefully handles malformed data

3. **Rate Limiting**
   - Cron job runs at controlled intervals
   - GitHub API calls are limited to eligible tasks
   - Failed requests don't retry immediately

## Migration

If you have existing agent tasks with PRs:

1. The PR tracking fields will be `null` for old tasks
2. Update old tasks manually with PR info:
   ```sql
   UPDATE tasks
   SET pr_url = 'https://github.com/owner/repo/pull/123',
       pr_branch = 'feature-branch'
   WHERE id = 'task-id';
   ```
3. Next cron run will check and update the task if PR is merged

## Future Enhancements

Potential improvements:

- **PR Comments**: Post comments on PRs when task status changes
- **Multi-repo Support**: Track PRs across multiple repositories in a single task
- **PR Status Webhooks**: Use GitHub webhooks instead of polling
- **Task Updates on PR Events**: Update task descriptions with PR review comments
- **PR Metrics**: Track time-to-merge, review cycles, etc.
- **Slack/Discord Notifications**: Notify team when PRs are merged and tasks complete

## Troubleshooting

### Task not marked as complete after PR merge

1. **Check PR tracking fields**:
   ```sql
   SELECT pr_url, pr_branch, pr_merged_at, status
   FROM tasks
   WHERE id = 'task-id';
   ```

2. **Verify PR URL format**:
   - Should be: `https://github.com/owner/repo/pull/...`
   - Check for typos or encoding issues

3. **Check GitHub token**:
   - Verify workspace has source control org linked
   - Ensure GitHub App is installed and tokens are valid

4. **Review cron logs**:
   - Look for errors specific to the task ID
   - Check if cron is running on schedule

5. **Manually test PR status**:
   ```bash
   curl -H "Authorization: token YOUR_TOKEN" \
     "https://api.github.com/repos/owner/repo/pulls?state=all&head=owner:branch-name"
   ```

### High error rate in cron execution

1. **Check GitHub API rate limits**:
   - GitHub API has rate limits (5000/hour for authenticated requests)
   - Reduce cron frequency if hitting limits

2. **Review common errors**:
   - "No GitHub access token available" → Re-authenticate GitHub App
   - "Could not parse PR URL" → Check data quality in database
   - Database errors → Check database connection and performance

3. **Enable debug logging**:
   - Temporarily add more detailed logs in `pr-tracking-cron.ts`
   - Monitor specific task IDs through execution

## Related Documentation

- [Task Agent Security](./task-agent.md) - Agent mode credential handling
- [GitHub App Setup](./github-app-setup.md) - GitHub App configuration
- [Task Coordinator](./task-coordinator.md) - Automated task management
- [Cron Jobs](./cron-jobs.md) - Setting up scheduled jobs
