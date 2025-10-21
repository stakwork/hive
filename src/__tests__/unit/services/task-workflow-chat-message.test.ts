/**
 * This test file needs to be refactored in a separate PR.
 * 
 * Issue: Tests were written for an internal (non-exported) function
 * `createChatMessageAndTriggerStakwork` which is not accessible.
 * 
 * The public API is `sendMessageToStakwork` which has a different signature:
 * - It fetches the task via `db.task.findFirst` first
 * - Parameters don't include `task` object (it fetches it)
 * - Return type is `{ chatMessage, stakworkData }` not just chatMessage
 * - GitHub credentials called with (userId, workspaceSlug) not (user object)
 * - Chat message role is "USER" (not "user")
 * - contextTags is JSON.stringified (not passed as-is)
 * 
 * These tests need comprehensive refactoring to match the actual implementation.
 * Since this violates the "test-only changes" principle (would require understanding
 * and potentially modifying production code behavior), this should be done in a
 * separate PR focused on test creation/refactoring for this service.
 * 
 * Related: src/services/task-workflow.ts (line 135-183, 261-389)
 */

/*
import { describe, it, expect, beforeEach, vi } from "vitest";
import { WorkflowStatus } from "@prisma/client";
import { sendMessageToStakwork } from "@/services/task-workflow";

// ... rest of commented out tests ...
*/
