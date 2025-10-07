import { db } from "@/lib/db";
import { ArtifactType } from "@/lib/chat";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import { createTestUser } from "./user";
import { createTestWorkspace } from "./workspace";

/**
 * Creates a complete test scenario with user, workspace, and task
 * Used by both unit and integration chat response tests
 */
export async function createChatTestScenario() {
  const testUser = await createTestUser({
    name: "Test User",
    email: `test-${generateUniqueId()}@example.com`,
  });

  const testWorkspace = await createTestWorkspace({
    name: "Test Workspace", 
    slug: generateUniqueId("test-workspace"),
    description: "Test workspace description",
    ownerId: testUser.id,
  });

  const testTask = await db.task.create({
    data: {
      id: generateUniqueId("task"),
      title: "Test Task",
      description: "Test task description", 
      status: "TODO",
      workspaceId: testWorkspace.id,
      createdById: testUser.id,
      updatedById: testUser.id,
    },
  });

  return { testUser, testWorkspace, testTask };
}

/**
 * Artifact test data factories for consistent test artifacts
 */
export const createArtifactTestData = {
  CODE: {
    type: ArtifactType.CODE,
    content: {
      language: "javascript",
      code: "console.log('Hello World');",
    },
    icon: "code",
  },
  
  FORM: {
    type: ArtifactType.FORM,
    content: {
      title: "User Survey",
      fields: [
        { name: "email", type: "email", required: true },
        { name: "feedback", type: "textarea", required: false },
      ],
    },
  },
  
  BROWSER: {
    type: ArtifactType.BROWSER,
    content: {
      url: "https://example.com",
      html: "<div>Preview content</div>",
    },
  },
  
  LONGFORM: {
    type: ArtifactType.LONGFORM,
    content: {
      title: "Project Documentation",
      body: "This is a long form document with detailed information...",
      sections: [
        { heading: "Introduction", content: "..." },
        { heading: "Getting Started", content: "..." },
      ],
    },
  },
  
  BUG_REPORT: {
    type: ArtifactType.BUG_REPORT,
    content: {
      title: "Login page crash",
      severity: "high",
      steps: [
        "Navigate to login page",
        "Enter invalid credentials", 
        "Click submit",
      ],
      expected: "Show error message",
      actual: "Page crashes",
    },
  },
};

/**
 * Context tags test data
 */
export const createContextTagTestData = {
  simple: [
    { type: "file", value: "src/index.ts" },
    { type: "repository", value: "https://github.com/user/repo" },
  ],
  
  complex: [
    {
      type: "file",
      value: "src/components/Button.tsx",
      metadata: {
        lines: [10, 50],
        modified: true,
        author: "test@example.com",
      },
    },
  ],
};
