# Production Deployment Task Update Fix

## Problem

When receiving production deployment webhooks, tasks were not being updated if they were beyond the 250-commit limit of GitHub's `compareCommits` API.

### Root Cause
- GitHub's `repos.compareCommits()` API returns a maximum of 250 commits
- The webhook handler relied solely on this comparison to determine which tasks to update
- Tasks with commits #251+ in the deployment range were silently ignored

### Impact
- Occurred when production deployments were infrequent (long gaps between deploys)
- High-velocity teams with many small commits hit this limit faster
- Tasks remained stuck in "staging" status even though deployed to production

## Solution

### Approach
Instead of relying on commit range comparison (limited to 250), we now:

1. **For PRODUCTION deployments**: Check ALL staging tasks individually
   - Query all tasks currently marked as STAGING
   - For each task's merge commit, verify if it's an ancestor of the production deployment commit
   - Use `compareCommits(base=task_commit, head=prod_commit)` to check inclusion
   - If status is "ahead" or "identical", the task is included
   - Add verified commits to the update list

2. **For STAGING deployments**: Keep existing behavior
   - Continue using commit range comparison (last deployment → current)
   - 250-commit limit is less problematic since staging deploys are frequent

### Code Changes

**File**: `/workspaces/hive/src/app/api/github/webhook/[workspaceId]/route.ts`

**Lines Modified**: ~720-780

**Key Logic**:
```typescript
if (environment === "PRODUCTION") {
  // Get all tasks currently in STAGING
  const stagingTasks = await db.$queryRaw`
    SELECT DISTINCT a.content->>'merge_commit_sha' as merge_commit_sha
    FROM artifacts a
    JOIN chat_messages m ON a.message_id = m.id
    JOIN tasks t ON m.task_id = t.id
    WHERE a.type = 'PULL_REQUEST'
      AND a.content->>'merge_commit_sha' IS NOT NULL
      AND t.repository_id = ${repository.id}
      AND t.deployment_status = 'STAGING'
      AND t.deleted = false
      AND t.archived = false
  `;
  
  // Check each staging task individually
  for (const task of stagingTasks) {
    const comparison = await octokit.repos.compareCommits({
      owner: repoOwner,
      repo: repoName,
      base: task.merge_commit_sha,
      head: commitSha,
    });
    
    // If production is ahead or identical, task is included
    if (comparison.data.status === "ahead" || comparison.data.status === "identical") {
      commitsInDeployment.push(task.merge_commit_sha);
    }
  }
}
```

## Testing

**Test File**: `/workspaces/hive/src/__tests__/integration/api/github/webhook-deployment-multi-task.test.ts`

**New Test**: `"should check ALL staging tasks on production deployment (not limited to 250 commits)"`

**Test Coverage**:
- ✅ Sets up 3 tasks in STAGING status
- ✅ Simulates production deployment webhook
- ✅ Verifies `compareCommits` called once per staging task (3 times)
- ✅ Confirms all staging tasks upgraded to PRODUCTION
- ✅ Validates deployment records created for all tasks

## Benefits

1. **No More Missed Tasks**: All staging tasks are checked, regardless of commit count
2. **Scalable**: Works with any gap size between deployments
3. **Individual Verification**: Each task verified independently against production
4. **Backward Compatible**: Staging deployments unchanged
5. **Fail-Safe**: Errors on individual comparisons logged but don't block others

## Monitoring

### Key Log Messages

**Production Deployment Started**:
```
[GithubWebhook] Production deployment detected - checking all staging tasks
{
  delivery: "...",
  commitSha: "abc123f",
  stagingTaskCount: 15
}
```

**Individual Task Comparison Failed** (warning):
```
[GithubWebhook] Failed to compare staging task commit
{
  delivery: "...",
  commitSha: "xyz789a",
  error: ...
}
```

**Production Verification Complete**:
```
[GithubWebhook] Production deployment commit verification complete
{
  delivery: "...",
  totalCommitsToUpdate: 18,
  stagingTasksChecked: 15
}
```

### Metrics to Watch

1. **stagingTaskCount**: Number of tasks checked per production deployment
   - Expected: 0-100 (depends on deployment frequency)
   - Alert if: >200 (may indicate performance issues)

2. **totalCommitsToUpdate**: Tasks verified for inclusion
   - Should be ≤ stagingTaskCount
   - Alert if: 0 on every production deploy (possible configuration issue)

3. **API Rate Limits**: Each staging task = 1 GitHub API call
   - With 100 staging tasks = 100 API calls per production deploy
   - GitHub rate limit: 5000/hour for authenticated requests

## Performance Considerations

### Best Case
- Few staging tasks (0-20): Minimal impact, <2 seconds
- Response time dominated by database queries

### Typical Case  
- Moderate staging tasks (20-50): ~3-5 seconds
- GitHub API calls run sequentially with error handling
- Acceptable for webhook processing (async)

### Worst Case
- Many staging tasks (>100): ~10-15 seconds
- Consider optimization if this becomes common:
  - Batch API calls with Promise.all()
  - Add pagination/chunking
  - Cache commit ancestry checks

### Current Limit
No artificial limit imposed. If performance becomes an issue:
```typescript
const MAX_STAGING_TASKS_TO_CHECK = 200;
const stagingTasks = await db.$queryRaw`
  SELECT ... LIMIT ${MAX_STAGING_TASKS_TO_CHECK}
`;
```

## Deployment Checklist

- [x] Code changes implemented
- [x] Tests added and passing
- [x] Log messages added for monitoring
- [x] Error handling for individual task failures
- [x] Backward compatibility maintained
- [ ] Deploy to staging environment
- [ ] Monitor staging logs for 1 week
- [ ] Deploy to production
- [ ] Monitor production deployment webhooks
- [ ] Verify no tasks stuck in staging after production deploys

## Rollback Plan

If issues arise, the fix can be rolled back by reverting the webhook route handler:

```bash
git revert <commit-hash>
```

The previous behavior will resume:
- Only checks commits within 250-commit range
- Tasks beyond #251 will be missed (known limitation)
- No production impact, just returns to previous state

## Future Enhancements

### Optional Improvements
1. **Batch API Calls**: Use `Promise.all()` for parallel checking
2. **Caching**: Cache commit ancestry results for repeated checks
3. **Progressive Update**: Update tasks as verified (streaming updates)
4. **Alerting**: Notify when many tasks stuck in staging

### Not Recommended
- ❌ Pagination through all commits: Still hits 250 limit per page
- ❌ Git clone + local comparison: Too slow, storage overhead
- ❌ Database tracking of commit ancestry: Complex, hard to maintain

## References

- GitHub API Docs: https://docs.github.com/en/rest/commits/commits#compare-two-commits
- Issue Discussion: [Internal issue link if applicable]
- Original Bug Report: [Link to issue]

## Contact

For questions or issues related to this fix:
- Code Owner: [Your team/name]
- Slack Channel: #deployments or #engineering
- On-call: [On-call rotation]
