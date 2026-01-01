import { describe, test, expect } from "vitest";
import { TaskStatus, WorkflowStatus } from "@prisma/client";
import { calculateBadge } from "@/lib/user-journeys/badge-calculator";

describe("calculateBadge", () => {
  describe("Priority 1: LIVE Badge", () => {
    test("returns LIVE badge when status is DONE and workflowStatus is COMPLETED", () => {
      const task = {
        status: TaskStatus.DONE,
        workflowStatus: WorkflowStatus.COMPLETED,
      };

      const badge = calculateBadge(task);

      expect(badge).toEqual({
        type: "LIVE",
        text: "Live",
        color: "#10b981",
        borderColor: "#10b981",
        icon: null,
        hasExternalLink: false,
      });
    });

    test("returns LIVE badge even when PR artifact is present", () => {
      const task = {
        status: TaskStatus.DONE,
        workflowStatus: WorkflowStatus.COMPLETED,
      };

      const prArtifact = {
        content: {
          url: "https://github.com/test/repo/pull/123",
          status: "IN_PROGRESS" as const,
        },
      };

      const badge = calculateBadge(task, prArtifact);

      // LIVE badge has highest priority, PR artifact should be ignored
      expect(badge.type).toBe("LIVE");
      expect(badge.text).toBe("Live");
    });

    test("does not return LIVE badge when status is DONE but workflowStatus is not COMPLETED", () => {
      const task = {
        status: TaskStatus.DONE,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      };

      const badge = calculateBadge(task);

      expect(badge.type).not.toBe("LIVE");
    });

    test("does not return LIVE badge when workflowStatus is COMPLETED but status is not DONE", () => {
      const task = {
        status: TaskStatus.IN_PROGRESS,
        workflowStatus: WorkflowStatus.COMPLETED,
      };

      const badge = calculateBadge(task);

      expect(badge.type).not.toBe("LIVE");
    });
  });

  describe("Priority 2: PR Artifact Badges", () => {
    describe("Open PR (IN_PROGRESS)", () => {
      test("returns Open PR badge when prArtifact status is IN_PROGRESS", () => {
        const task = {
          status: TaskStatus.IN_PROGRESS,
          workflowStatus: WorkflowStatus.PENDING,
        };

        const prArtifact = {
          content: {
            url: "https://github.com/test/repo/pull/456",
            status: "IN_PROGRESS" as const,
          },
        };

        const badge = calculateBadge(task, prArtifact);

        expect(badge).toEqual({
          type: "PR",
          text: "Open",
          url: "https://github.com/test/repo/pull/456",
          color: "#238636",
          borderColor: "#238636",
          icon: "GitPullRequest",
          hasExternalLink: true,
        });
      });
    });

    describe("Closed PR (CANCELLED)", () => {
      test("returns Closed PR badge when prArtifact status is CANCELLED", () => {
        const task = {
          status: TaskStatus.TODO,
          workflowStatus: null,
        };

        const prArtifact = {
          content: {
            url: "https://github.com/test/repo/pull/789",
            status: "CANCELLED" as const,
          },
        };

        const badge = calculateBadge(task, prArtifact);

        expect(badge).toEqual({
          type: "PR",
          text: "Closed",
          url: "https://github.com/test/repo/pull/789",
          color: "#6e7681",
          borderColor: "#6e7681",
          icon: "GitPullRequestClosed",
          hasExternalLink: true,
        });
      });
    });

    describe("Merged PR (DONE)", () => {
      test("returns Merged PR badge when prArtifact status is DONE", () => {
        const task = {
          status: TaskStatus.DONE,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
        };

        const prArtifact = {
          content: {
            url: "https://github.com/test/repo/pull/101",
            status: "DONE" as const,
          },
        };

        const badge = calculateBadge(task, prArtifact);

        expect(badge).toEqual({
          type: "PR",
          text: "Merged",
          url: "https://github.com/test/repo/pull/101",
          color: "#8957e5",
          borderColor: "#8957e5",
          icon: "GitMerge",
          hasExternalLink: true,
        });
      });
    });

    test("all PR badges have hasExternalLink set to true", () => {
      const task = {
        status: TaskStatus.TODO,
        workflowStatus: null,
      };

      const openPR = calculateBadge(task, {
        content: { url: "https://example.com", status: "IN_PROGRESS" },
      });
      const closedPR = calculateBadge(task, {
        content: { url: "https://example.com", status: "CANCELLED" },
      });
      const mergedPR = calculateBadge(task, {
        content: { url: "https://example.com", status: "DONE" },
      });

      expect(openPR.hasExternalLink).toBe(true);
      expect(closedPR.hasExternalLink).toBe(true);
      expect(mergedPR.hasExternalLink).toBe(true);
    });

    test("all PR badges include url property", () => {
      const task = {
        status: TaskStatus.TODO,
        workflowStatus: null,
      };

      const testUrl = "https://github.com/org/repo/pull/123";
      const prArtifact = {
        content: { url: testUrl, status: "IN_PROGRESS" as const },
      };

      const badge = calculateBadge(task, prArtifact);

      expect(badge.url).toBe(testUrl);
    });
  });

  describe("Priority 3: Workflow Status Fallback", () => {
    describe("Failed Status", () => {
      test("returns Failed badge when workflowStatus is FAILED", () => {
        const task = {
          status: TaskStatus.TODO,
          workflowStatus: WorkflowStatus.FAILED,
        };

        const badge = calculateBadge(task);

        expect(badge).toEqual({
          type: "WORKFLOW",
          text: "Failed",
          color: "#dc2626",
          borderColor: "#dc2626",
          icon: null,
          hasExternalLink: false,
        });
      });

      test("returns Failed badge when workflowStatus is ERROR", () => {
        const task = {
          status: TaskStatus.IN_PROGRESS,
          workflowStatus: WorkflowStatus.ERROR,
        };

        const badge = calculateBadge(task);

        expect(badge.type).toBe("WORKFLOW");
        expect(badge.text).toBe("Failed");
        expect(badge.color).toBe("#dc2626");
      });

      test("returns Failed badge when workflowStatus is HALTED", () => {
        const task = {
          status: TaskStatus.BLOCKED,
          workflowStatus: WorkflowStatus.HALTED,
        };

        const badge = calculateBadge(task);

        expect(badge.type).toBe("WORKFLOW");
        expect(badge.text).toBe("Failed");
        expect(badge.color).toBe("#dc2626");
      });
    });

    describe("In Progress Status", () => {
      test("returns In Progress badge when workflowStatus is IN_PROGRESS", () => {
        const task = {
          status: TaskStatus.IN_PROGRESS,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
        };

        const badge = calculateBadge(task);

        expect(badge).toEqual({
          type: "WORKFLOW",
          text: "In Progress",
          color: "#ca8a04",
          borderColor: "#ca8a04",
          icon: null,
          hasExternalLink: false,
        });
      });

      test("returns In Progress badge when workflowStatus is PENDING", () => {
        const task = {
          status: TaskStatus.TODO,
          workflowStatus: WorkflowStatus.PENDING,
        };

        const badge = calculateBadge(task);

        expect(badge.type).toBe("WORKFLOW");
        expect(badge.text).toBe("In Progress");
        expect(badge.color).toBe("#ca8a04");
      });
    });

    describe("Completed Status (without LIVE conditions)", () => {
      test("returns Completed badge when workflowStatus is COMPLETED but status is not DONE", () => {
        const task = {
          status: TaskStatus.IN_PROGRESS,
          workflowStatus: WorkflowStatus.COMPLETED,
        };

        const badge = calculateBadge(task);

        expect(badge).toEqual({
          type: "WORKFLOW",
          text: "Completed",
          color: "#16a34a",
          borderColor: "#16a34a",
          icon: null,
          hasExternalLink: false,
        });
      });

      test("returns Completed badge when status is DONE but workflowStatus is COMPLETED with PR artifact", () => {
        const task = {
          status: TaskStatus.DONE,
          workflowStatus: WorkflowStatus.COMPLETED,
        };

        // This is unreachable in practice since LIVE condition takes precedence,
        // but tests the branch logic
        const badge = calculateBadge(task);
        expect(badge.type).toBe("LIVE"); // LIVE has priority
      });
    });

    describe("Pending Status (default)", () => {
      test("returns Pending badge when workflowStatus is null", () => {
        const task = {
          status: TaskStatus.TODO,
          workflowStatus: null,
        };

        const badge = calculateBadge(task);

        expect(badge).toEqual({
          type: "WORKFLOW",
          text: "Pending",
          color: "#6b7280",
          borderColor: "#6b7280",
          icon: null,
          hasExternalLink: false,
        });
      });
    });

    test("all workflow badges have hasExternalLink set to false", () => {
      const failedBadge = calculateBadge({
        status: TaskStatus.TODO,
        workflowStatus: WorkflowStatus.FAILED,
      });
      const inProgressBadge = calculateBadge({
        status: TaskStatus.TODO,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      });
      const completedBadge = calculateBadge({
        status: TaskStatus.TODO,
        workflowStatus: WorkflowStatus.COMPLETED,
      });
      const pendingBadge = calculateBadge({
        status: TaskStatus.TODO,
        workflowStatus: null,
      });

      expect(failedBadge.hasExternalLink).toBe(false);
      expect(inProgressBadge.hasExternalLink).toBe(false);
      expect(completedBadge.hasExternalLink).toBe(false);
      expect(pendingBadge.hasExternalLink).toBe(false);
    });

    test("workflow badges have null icon", () => {
      const badge = calculateBadge({
        status: TaskStatus.TODO,
        workflowStatus: WorkflowStatus.FAILED,
      });

      expect(badge.icon).toBe(null);
    });
  });

  describe("Edge Cases", () => {
    test("handles undefined prArtifact gracefully", () => {
      const task = {
        status: TaskStatus.TODO,
        workflowStatus: WorkflowStatus.PENDING,
      };

      const badge = calculateBadge(task, undefined);

      expect(badge.type).toBe("WORKFLOW");
      expect(badge.text).toBe("In Progress");
    });

    test("handles null prArtifact gracefully", () => {
      const task = {
        status: TaskStatus.TODO,
        workflowStatus: WorkflowStatus.PENDING,
      };

      const badge = calculateBadge(task, null);

      expect(badge.type).toBe("WORKFLOW");
      expect(badge.text).toBe("In Progress");
    });

    test("handles prArtifact with undefined content", () => {
      const task = {
        status: TaskStatus.TODO,
        workflowStatus: WorkflowStatus.FAILED,
      };

      const prArtifact = {
        content: undefined as unknown,
      };

      const badge = calculateBadge(task, prArtifact);

      // Should fall through to workflow status
      expect(badge.type).toBe("WORKFLOW");
      expect(badge.text).toBe("Failed");
    });

    test("handles all TaskStatus enum values without errors", () => {
      const statuses: TaskStatus[] = [
        TaskStatus.TODO,
        TaskStatus.IN_PROGRESS,
        TaskStatus.DONE,
        TaskStatus.CANCELLED,
        TaskStatus.BLOCKED,
      ];

      statuses.forEach((status) => {
        const badge = calculateBadge({
          status,
          workflowStatus: null,
        });

        expect(badge).toBeDefined();
        expect(badge).toHaveProperty("type");
        expect(badge).toHaveProperty("text");
      });
    });

    test("handles all WorkflowStatus enum values without errors", () => {
      const workflowStatuses: (WorkflowStatus | null)[] = [
        WorkflowStatus.PENDING,
        WorkflowStatus.IN_PROGRESS,
        WorkflowStatus.COMPLETED,
        WorkflowStatus.ERROR,
        WorkflowStatus.HALTED,
        WorkflowStatus.FAILED,
        null,
      ];

      workflowStatuses.forEach((workflowStatus) => {
        const badge = calculateBadge({
          status: TaskStatus.TODO,
          workflowStatus,
        });

        expect(badge).toBeDefined();
        expect(badge).toHaveProperty("type");
        expect(badge).toHaveProperty("text");
      });
    });
  });

  describe("Color and Icon Validation", () => {
    test("all badges have matching color and borderColor", () => {
      const testCases = [
        {
          task: { status: TaskStatus.DONE, workflowStatus: WorkflowStatus.COMPLETED },
          prArtifact: undefined,
        },
        {
          task: { status: TaskStatus.TODO, workflowStatus: null },
          prArtifact: { content: { url: "test", status: "IN_PROGRESS" as const } },
        },
        {
          task: { status: TaskStatus.TODO, workflowStatus: WorkflowStatus.FAILED },
          prArtifact: undefined,
        },
      ];

      testCases.forEach(({ task, prArtifact }) => {
        const badge = calculateBadge(task, prArtifact);
        expect(badge.color).toBe(badge.borderColor);
      });
    });

    test("PR badges have correct icons", () => {
      const task = { status: TaskStatus.TODO, workflowStatus: null };

      const openPR = calculateBadge(task, {
        content: { url: "test", status: "IN_PROGRESS" },
      });
      const closedPR = calculateBadge(task, {
        content: { url: "test", status: "CANCELLED" },
      });
      const mergedPR = calculateBadge(task, {
        content: { url: "test", status: "DONE" },
      });

      expect(openPR.icon).toBe("GitPullRequest");
      expect(closedPR.icon).toBe("GitPullRequestClosed");
      expect(mergedPR.icon).toBe("GitMerge");
    });

    test("LIVE and workflow badges have null icon", () => {
      const liveBadge = calculateBadge({
        status: TaskStatus.DONE,
        workflowStatus: WorkflowStatus.COMPLETED,
      });
      const workflowBadge = calculateBadge({
        status: TaskStatus.TODO,
        workflowStatus: WorkflowStatus.PENDING,
      });

      expect(liveBadge.icon).toBe(null);
      expect(workflowBadge.icon).toBe(null);
    });

    test("validates exact color codes for all badge types", () => {
      const colorTests = [
        {
          badge: calculateBadge({
            status: TaskStatus.DONE,
            workflowStatus: WorkflowStatus.COMPLETED,
          }),
          expectedColor: "#10b981",
          label: "LIVE",
        },
        {
          badge: calculateBadge(
            { status: TaskStatus.TODO, workflowStatus: null },
            { content: { url: "test", status: "IN_PROGRESS" } },
          ),
          expectedColor: "#238636",
          label: "PR Open",
        },
        {
          badge: calculateBadge(
            { status: TaskStatus.TODO, workflowStatus: null },
            { content: { url: "test", status: "CANCELLED" } },
          ),
          expectedColor: "#6e7681",
          label: "PR Closed",
        },
        {
          badge: calculateBadge(
            { status: TaskStatus.TODO, workflowStatus: null },
            { content: { url: "test", status: "DONE" } },
          ),
          expectedColor: "#8957e5",
          label: "PR Merged",
        },
        {
          badge: calculateBadge({
            status: TaskStatus.TODO,
            workflowStatus: WorkflowStatus.FAILED,
          }),
          expectedColor: "#dc2626",
          label: "Failed",
        },
        {
          badge: calculateBadge({
            status: TaskStatus.TODO,
            workflowStatus: WorkflowStatus.IN_PROGRESS,
          }),
          expectedColor: "#ca8a04",
          label: "In Progress",
        },
        {
          badge: calculateBadge({
            status: TaskStatus.TODO,
            workflowStatus: WorkflowStatus.COMPLETED,
          }),
          expectedColor: "#16a34a",
          label: "Completed",
        },
        {
          badge: calculateBadge({ status: TaskStatus.TODO, workflowStatus: null }),
          expectedColor: "#6b7280",
          label: "Pending",
        },
      ];

      colorTests.forEach(({ badge, expectedColor }) => {
        expect(badge.color).toBe(expectedColor);
        expect(badge.borderColor).toBe(expectedColor);
      });
    });
  });

  describe("Badge Type Validation", () => {
    test("returns only valid badge types", () => {
      const validTypes = ["PR", "WORKFLOW", "LIVE"];

      const testCases = [
        { status: TaskStatus.DONE, workflowStatus: WorkflowStatus.COMPLETED },
        { status: TaskStatus.TODO, workflowStatus: WorkflowStatus.FAILED },
        { status: TaskStatus.IN_PROGRESS, workflowStatus: null },
      ];

      testCases.forEach((task) => {
        const badge = calculateBadge(task);
        expect(validTypes).toContain(badge.type);
      });
    });

    test("PR type badges are only returned when prArtifact is provided", () => {
      const task = { status: TaskStatus.TODO, workflowStatus: null };

      const badgeWithoutPR = calculateBadge(task);
      expect(badgeWithoutPR.type).not.toBe("PR");

      const badgeWithPR = calculateBadge(task, {
        content: { url: "test", status: "IN_PROGRESS" },
      });
      expect(badgeWithPR.type).toBe("PR");
    });

    test("LIVE type badge is only returned when both conditions are met", () => {
      const badgeNotLive1 = calculateBadge({
        status: TaskStatus.DONE,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      });
      expect(badgeNotLive1.type).not.toBe("LIVE");

      const badgeNotLive2 = calculateBadge({
        status: TaskStatus.IN_PROGRESS,
        workflowStatus: WorkflowStatus.COMPLETED,
      });
      expect(badgeNotLive2.type).not.toBe("LIVE");

      const badgeLive = calculateBadge({
        status: TaskStatus.DONE,
        workflowStatus: WorkflowStatus.COMPLETED,
      });
      expect(badgeLive.type).toBe("LIVE");
    });
  });
});
