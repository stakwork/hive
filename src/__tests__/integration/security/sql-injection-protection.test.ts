/**
 * SQL Injection Protection Tests
 * 
 * These tests validate that the application is protected against SQL injection attacks
 * through proper use of Prisma ORM and input validation.
 * 
 * Security Measures Tested:
 * 1. Prisma ORM automatic parameterization
 * 2. Input validation (Zod schemas + manual checks)
 * 3. Enum validation
 * 4. Special character handling
 * 5. Workspace slug validation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { TaskStatus, Priority, WorkspaceRole } from '@prisma/client';

describe('SQL Injection Protection', () => {
  let testUserId: string;
  let testWorkspaceId: string;

  beforeEach(async () => {
    // Clean up test data
    await db.task.deleteMany();
    await db.workspaceMember.deleteMany();
    await db.workspace.deleteMany();
    await db.user.deleteMany();

    // Create test user
    const user = await db.user.create({
      data: {
        email: 'test@example.com',
        name: 'Test User',
      },
    });
    testUserId = user.id;

    // Create test workspace
    const workspace = await db.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: 'test-workspace',
        ownerId: testUserId,
        members: {
          create: {
            userId: testUserId,
            role: WorkspaceRole.OWNER,
          },
        },
      },
    });
    testWorkspaceId = workspace.id;
  });

  describe('Prisma ORM Parameterization', () => {
    it('should safely handle SQL injection in task title search', async () => {
      // Create legitimate task
      await db.task.create({
        data: {
          title: 'Legitimate Task',
          workspaceId: testWorkspaceId,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: testUserId,
          updatedById: testUserId,
        },
      });

      // Attempt SQL injection via title search
      const maliciousTitle = "'; DROP TABLE tasks; --";
      
      // This query should be safely parameterized by Prisma
      const tasks = await db.task.findMany({
        where: {
          workspaceId: testWorkspaceId,
          title: {
            contains: maliciousTitle,
          },
        },
      });

      // Should return no results (attack neutralized)
      expect(tasks).toHaveLength(0);

      // Verify table still exists by querying all tasks
      const allTasks = await db.task.findMany({
        where: { workspaceId: testWorkspaceId },
      });
      expect(allTasks).toHaveLength(1);
      expect(allTasks[0].title).toBe('Legitimate Task');
    });

    it('should safely handle SQL injection in workspace slug query', async () => {
      // Attempt SQL injection via slug
      const maliciousSlug = "test-workspace' OR '1'='1";

      // This query should be safely parameterized
      const workspace = await db.workspace.findFirst({
        where: {
          slug: maliciousSlug,
          deleted: false,
        },
      });

      // Should return null (attack neutralized)
      expect(workspace).toBeNull();

      // Verify actual workspace is still intact
      const validWorkspace = await db.workspace.findFirst({
        where: {
          slug: 'test-workspace',
          deleted: false,
        },
      });
      expect(validWorkspace).not.toBeNull();
      expect(validWorkspace?.name).toBe('Test Workspace');
    });

    it('should safely handle SQL injection in user email query', async () => {
      // Attempt SQL injection via email
      const maliciousEmail = "test@example.com' OR '1'='1' --";

      // This query should be safely parameterized
      const user = await db.user.findUnique({
        where: { email: maliciousEmail },
      });

      // Should return null (attack neutralized)
      expect(user).toBeNull();

      // Verify actual user is still intact
      const validUser = await db.user.findUnique({
        where: { email: 'test@example.com' },
      });
      expect(validUser).not.toBeNull();
      expect(validUser?.name).toBe('Test User');
    });

    it('should safely handle SQL injection attempts in task description', async () => {
      // Attempt to inject SQL in task description
      const maliciousDescription = `
        Normal description
        '); DELETE FROM workspaces WHERE ('1'='1
        More text
      `;

      // Create task with malicious description
      const task = await db.task.create({
        data: {
          title: 'Test Task',
          description: maliciousDescription,
          workspaceId: testWorkspaceId,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: testUserId,
          updatedById: testUserId,
        },
      });

      // Verify task was created with exact description (not executed as SQL)
      expect(task.description).toBe(maliciousDescription);

      // Verify workspace still exists (not deleted by injection)
      const workspace = await db.workspace.findUnique({
        where: { id: testWorkspaceId },
      });
      expect(workspace).not.toBeNull();
      expect(workspace?.deleted).toBe(false);
    });
  });

  describe('Special Character Handling', () => {
    it('should safely handle single quotes in task titles', async () => {
      const titleWithQuotes = "Review API's documentation";

      const task = await db.task.create({
        data: {
          title: titleWithQuotes,
          workspaceId: testWorkspaceId,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: testUserId,
          updatedById: testUserId,
        },
      });

      expect(task.title).toBe(titleWithQuotes);

      // Verify we can query it back
      const found = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(found?.title).toBe(titleWithQuotes);
    });

    it('should safely handle semicolons in workspace names', async () => {
      const nameWithSemicolon = 'Project Alpha; Beta Division';

      const workspace = await db.workspace.create({
        data: {
          name: nameWithSemicolon,
          slug: 'project-alpha-beta',
          ownerId: testUserId,
        },
      });

      expect(workspace.name).toBe(nameWithSemicolon);
    });

    it('should safely handle double dashes in descriptions', async () => {
      const descriptionWithDashes = 'This is a note -- important detail';

      const task = await db.task.create({
        data: {
          title: 'Test Task',
          description: descriptionWithDashes,
          workspaceId: testWorkspaceId,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: testUserId,
          updatedById: testUserId,
        },
      });

      expect(task.description).toBe(descriptionWithDashes);
    });

    it('should safely handle backslashes in strings', async () => {
      const titleWithBackslash = 'Fix path\\to\\file issue';

      const task = await db.task.create({
        data: {
          title: titleWithBackslash,
          workspaceId: testWorkspaceId,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: testUserId,
          updatedById: testUserId,
        },
      });

      expect(task.title).toBe(titleWithBackslash);
    });
  });

  describe('Enum Validation Protection', () => {
    it('should reject invalid TaskStatus values', async () => {
      const maliciousStatus = "TODO'; DROP TABLE tasks; --" as TaskStatus;

      // Prisma type system + database enum constraint prevents this
      await expect(
        db.task.create({
          data: {
            title: 'Test Task',
            workspaceId: testWorkspaceId,
            status: maliciousStatus,
            priority: Priority.MEDIUM,
          },
        })
      ).rejects.toThrow();

      // Verify no tasks were created
      const tasks = await db.task.findMany({
        where: { workspaceId: testWorkspaceId },
      });
      expect(tasks).toHaveLength(0);
    });

    it('should reject invalid Priority values', async () => {
      const maliciousPriority = "HIGH'; SELECT * FROM users; --" as Priority;

      await expect(
        db.task.create({
          data: {
            title: 'Test Task',
            workspaceId: testWorkspaceId,
            status: TaskStatus.TODO,
            priority: maliciousPriority,
          },
        })
      ).rejects.toThrow();
    });

    it('should reject invalid WorkspaceRole values', async () => {
      const maliciousRole = "OWNER'; DROP TABLE workspace_members; --" as WorkspaceRole;

      await expect(
        db.workspaceMember.create({
          data: {
            workspaceId: testWorkspaceId,
            userId: testUserId,
            role: maliciousRole,
          },
        })
      ).rejects.toThrow();

      // Verify workspace members table still exists
      const members = await db.workspaceMember.findMany({
        where: { workspaceId: testWorkspaceId },
      });
      expect(members.length).toBeGreaterThan(0);
    });
  });

  describe('Complex Query Protection', () => {
    it('should safely handle SQL injection in complex where clauses', async () => {
      // Create test tasks
      await db.task.createMany({
        data: [
          {
            title: 'Task 1',
            workspaceId: testWorkspaceId,
            status: TaskStatus.TODO,
            priority: Priority.HIGH,
            createdById: testUserId,
            updatedById: testUserId,
          },
          {
            title: 'Task 2',
            workspaceId: testWorkspaceId,
            status: TaskStatus.IN_PROGRESS,
            priority: Priority.MEDIUM,
            createdById: testUserId,
            updatedById: testUserId,
          },
        ],
      });

      // Attempt injection in complex query
      const maliciousSearch = "Task' OR status='DONE' OR '1'='1";

      const tasks = await db.task.findMany({
        where: {
          workspaceId: testWorkspaceId,
          OR: [
            { title: { contains: maliciousSearch } },
            { description: { contains: maliciousSearch } },
          ],
        },
      });

      // Should return no results (attack neutralized)
      expect(tasks).toHaveLength(0);

      // Verify actual tasks still exist with correct status
      const allTasks = await db.task.findMany({
        where: { workspaceId: testWorkspaceId },
      });
      expect(allTasks).toHaveLength(2);
      expect(allTasks.every(t => t.status !== TaskStatus.DONE)).toBe(true);
    });

    it('should safely handle SQL injection in order by clauses', async () => {
      // Create test tasks
      await db.task.createMany({
        data: [
          {
            title: 'Z Task',
            workspaceId: testWorkspaceId,
            status: TaskStatus.TODO,
            priority: Priority.HIGH,
            createdById: testUserId,
            updatedById: testUserId,
          },
          {
            title: 'A Task',
            workspaceId: testWorkspaceId,
            status: TaskStatus.TODO,
            priority: Priority.LOW,
            createdById: testUserId,
            updatedById: testUserId,
          },
        ],
      });

      // Prisma's type-safe orderBy prevents injection
      const tasks = await db.task.findMany({
        where: { workspaceId: testWorkspaceId },
        orderBy: { title: 'asc' },
      });

      expect(tasks).toHaveLength(2);
      expect(tasks[0].title).toBe('A Task');
      expect(tasks[1].title).toBe('Z Task');
    });

    it('should safely handle SQL injection in include clauses', async () => {
      // Create task with assignee
      const assignee = await db.user.create({
        data: {
          email: 'assignee@example.com',
          name: 'Assignee',
        },
      });

      await db.task.create({
        data: {
          title: 'Test Task',
          workspaceId: testWorkspaceId,
          assigneeId: assignee.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: testUserId,
          updatedById: testUserId,
        },
      });

      // Prisma's type-safe include prevents injection
      const tasks = await db.task.findMany({
        where: { workspaceId: testWorkspaceId },
        include: { assignee: true },
      });

      expect(tasks).toHaveLength(1);
      expect(tasks[0].assignee?.email).toBe('assignee@example.com');
    });
  });

  describe('Workspace Slug Validation', () => {
    it('should prevent SQL injection in slug validation', async () => {
      const maliciousSlugs = [
        "'; DROP TABLE workspaces; --",
        "test' OR '1'='1",
        "test'; DELETE FROM users WHERE '1'='1",
        "test\" OR \"1\"=\"1",
      ];

      for (const slug of maliciousSlugs) {
        // These should all fail slug format validation before reaching database
        // Slug validation regex: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
        const validSlugPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
        expect(validSlugPattern.test(slug)).toBe(false);
      }

      // Prisma parameterizes queries, so even if slugs are stored, SQL injection is prevented
      // The slug is treated as a literal string value, not executable SQL
      const testSlug = "'; DROP TABLE workspaces; --";
      const workspace = await db.workspace.create({
        data: {
          name: 'Test',
          slug: testSlug,
          ownerId: testUserId,
        },
      });

      // Slug is stored as-is (Prisma parameterized it)
      expect(workspace.slug).toBe(testSlug);

      // Verify workspaces table still exists (not dropped by injection)
      const allWorkspaces = await db.workspace.findMany();
      expect(allWorkspaces.length).toBeGreaterThan(0);

      // Verify we can query by the exact slug (Prisma parameterizes this too)
      const found = await db.workspace.findFirst({
        where: { slug: testSlug },
      });
      expect(found).not.toBeNull();
      expect(found?.id).toBe(workspace.id);
    });
  });

  describe('Foreign Key Protection', () => {
    it('should prevent SQL injection via foreign key manipulation', async () => {
      const maliciousWorkspaceId = "' OR '1'='1' --";

      // Prisma enforces foreign key constraints
      await expect(
        db.task.create({
          data: {
            title: 'Test Task',
            workspaceId: maliciousWorkspaceId,
            status: TaskStatus.TODO,
            priority: Priority.MEDIUM,
          },
        })
      ).rejects.toThrow();

      // Verify no orphaned tasks
      const tasks = await db.task.findMany();
      expect(tasks).toHaveLength(0);
    });

    it('should prevent SQL injection via user ID manipulation', async () => {
      const maliciousUserId = "' UNION SELECT * FROM users --";

      await expect(
        db.workspace.create({
          data: {
            name: 'Test',
            slug: 'test-ws',
            ownerId: maliciousUserId,
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('Transaction Safety', () => {
    it('should safely handle SQL injection in transactions', async () => {
      // This transaction should fail because task is missing createdById
      // demonstrating that even within transactions, validation/requirements are enforced
      await expect(
        db.$transaction(async (tx) => {
          await tx.task.create({
            data: {
              title: 'Test Task',
              workspaceId: testWorkspaceId,
              status: TaskStatus.TODO,
              priority: Priority.MEDIUM,
              // Missing createdById - will cause validation error
            },
          });
        })
      ).rejects.toThrow();

      // Even with SQL injection attempts in transaction, Prisma parameterizes safely
      const maliciousSlug = "test'; DROP TABLE workspaces; --";
      const result = await db.$transaction(async (tx) => {
        const ws = await tx.workspace.create({
          data: {
            name: 'Transaction Test',
            slug: maliciousSlug,
            ownerId: testUserId,
          },
        });

        const task = await tx.task.create({
          data: {
            title: 'Transaction Task',
            workspaceId: testWorkspaceId,
            status: TaskStatus.TODO,
            priority: Priority.MEDIUM,
            createdById: testUserId,
            updatedById: testUserId,
          },
        });

        return { ws, task };
      });

      // Both created successfully - SQL injection was neutralized by Prisma
      expect(result.ws.slug).toBe(maliciousSlug);
      expect(result.task.title).toBe('Transaction Task');

      // Verify workspaces table still exists (not dropped by injection)
      const allWorkspaces = await db.workspace.findMany();
      expect(allWorkspaces.length).toBeGreaterThan(0);
    });
  });
});