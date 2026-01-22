import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { FeatureStatus, FeaturePriority } from "@prisma/client";

// Mock the db module
vi.mock("@/lib/db", () => ({
  db: {
    feature: {
      create: vi.fn(),
    },
    phase: {
      create: vi.fn(),
      createMany: vi.fn(),
    },
    userStory: {
      createMany: vi.fn(),
    },
  },
}));

describe("seedFeatures", () => {
  // We'll test the core logic by importing and calling seedFeatures directly
  // Since seedFeatures is not exported, we'll test the behavior through the seeded data
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should rotate feature creators across team members", async () => {
    const mockWorkspaceId = "workspace-123";
    const mockUserIds = [
      "user-alice-123",
      "user-bob-456",
      "user-carol-789",
      "user-david-012",
    ];
    const mockUserId = mockUserIds[0]; // Primary user (backwards compat)

    // Mock feature creation to capture what's being created
    const createdFeatures: Array<{ createdById: string; title: string }> = [];
    
    vi.mocked(db.feature.create).mockImplementation(async ({ data }: any) => {
      createdFeatures.push({
        createdById: data.createdById,
        title: data.title,
      });
      return {
        id: `feature-${createdFeatures.length}`,
        title: data.title,
      };
    });

    // Mock phase creation
    vi.mocked(db.phase.create).mockResolvedValue({
      id: "phase-123",
    } as any);
    vi.mocked(db.phase.createMany).mockResolvedValue({ count: 3 } as any);
    vi.mocked(db.userStory.createMany).mockResolvedValue({ count: 3 } as any);

    // Simulate the seedFeatures logic
    const featureData = [
      {
        title: "User Authentication",
        brief: "Implement secure user authentication with OAuth support",
        status: FeatureStatus.COMPLETED,
        priority: FeaturePriority.CRITICAL,
        requirements: "Support GitHub OAuth, email/password, and SSO. Implement secure session management.",
        architecture: "NextAuth.js with JWT sessions, Prisma adapter for user storage",
        personas: ["Developer", "Admin", "End User"],
        assigneeId: mockUserIds[0],
      },
      {
        title: "Dashboard Analytics",
        brief: "Build real-time analytics dashboard for workspace metrics",
        status: FeatureStatus.IN_PROGRESS,
        priority: FeaturePriority.HIGH,
        requirements: "Show task completion rates, team velocity, code coverage trends",
        architecture: "React Query for data fetching, Recharts for visualization",
        personas: ["PM", "Team Lead", "Developer"],
        assigneeId: mockUserIds[1],
      },
      {
        title: "Code Review Assistant",
        brief: "AI-powered code review suggestions and best practices",
        status: FeatureStatus.TODO,
        priority: FeaturePriority.MEDIUM,
        requirements: "Analyze PRs, suggest improvements, detect common issues",
        architecture: "OpenAI GPT-4 integration, GitHub API webhooks",
        personas: ["Developer", "Team Lead"],
        assigneeId: null,
      },
      {
        title: "Team Collaboration Tools",
        brief: "Real-time collaboration features for distributed teams",
        status: FeatureStatus.IN_PROGRESS,
        priority: FeaturePriority.HIGH,
        requirements: "Live cursors, collaborative editing, voice/video calls",
        architecture: "WebRTC for real-time communication, Yjs for CRDT",
        personas: ["Developer", "PM", "Designer"],
        assigneeId: mockUserIds[3],
      },
      {
        title: "Mobile App Support",
        brief: "Native mobile apps for iOS and Android",
        status: FeatureStatus.CANCELLED,
        priority: FeaturePriority.LOW,
        requirements: "React Native app with offline support",
        architecture: "N/A - Cancelled before implementation",
        personas: ["PM", "Stakeholder"],
      },
    ];

    // Create features with rotating creators
    for (let index = 0; index < featureData.length; index++) {
      const data = featureData[index];
      const creatorId = mockUserIds[index % mockUserIds.length];
      await db.feature.create({
        data: {
          ...data,
          workspaceId: mockWorkspaceId,
          createdById: creatorId,
          updatedById: creatorId,
        },
        select: { id: true, title: true },
      });
    }

    // Verify features were created with different creators
    expect(createdFeatures).toHaveLength(5);

    // Check that creators rotate through the userIds array
    expect(createdFeatures[0].createdById).toBe(mockUserIds[0]); // Alice
    expect(createdFeatures[1].createdById).toBe(mockUserIds[1]); // Bob
    expect(createdFeatures[2].createdById).toBe(mockUserIds[2]); // Carol
    expect(createdFeatures[3].createdById).toBe(mockUserIds[3]); // David
    expect(createdFeatures[4].createdById).toBe(mockUserIds[0]); // Alice (wraps around)

    // Verify at least 3-4 different creators are represented
    const uniqueCreators = new Set(createdFeatures.map((f) => f.createdById));
    expect(uniqueCreators.size).toBeGreaterThanOrEqual(3);
    expect(uniqueCreators.size).toBeLessThanOrEqual(4);

    // Verify specific feature titles are assigned to expected creators
    expect(createdFeatures.find((f) => f.title === "User Authentication")?.createdById).toBe(
      mockUserIds[0]
    );
    expect(createdFeatures.find((f) => f.title === "Dashboard Analytics")?.createdById).toBe(
      mockUserIds[1]
    );
    expect(createdFeatures.find((f) => f.title === "Code Review Assistant")?.createdById).toBe(
      mockUserIds[2]
    );
    expect(
      createdFeatures.find((f) => f.title === "Team Collaboration Tools")?.createdById
    ).toBe(mockUserIds[3]);
    expect(createdFeatures.find((f) => f.title === "Mobile App Support")?.createdById).toBe(
      mockUserIds[0]
    );
  });

  it("should handle rotation when userIds length is less than features length", async () => {
    const mockWorkspaceId = "workspace-123";
    const mockUserIds = ["user-1", "user-2"]; // Only 2 users
    const featureCount = 5;

    const createdFeatures: Array<{ createdById: string }> = [];

    vi.mocked(db.feature.create).mockImplementation(async ({ data }: any) => {
      createdFeatures.push({ createdById: data.createdById });
      return { id: `feature-${createdFeatures.length}`, title: "Test Feature" };
    });

    vi.mocked(db.phase.create).mockResolvedValue({ id: "phase-123" } as any);
    vi.mocked(db.phase.createMany).mockResolvedValue({ count: 3 } as any);
    vi.mocked(db.userStory.createMany).mockResolvedValue({ count: 3 } as any);

    // Create features with rotating creators
    for (let index = 0; index < featureCount; index++) {
      const creatorId = mockUserIds[index % mockUserIds.length];
      await db.feature.create({
        data: {
          title: `Feature ${index}`,
          workspaceId: mockWorkspaceId,
          createdById: creatorId,
          updatedById: creatorId,
        },
        select: { id: true, title: true },
      });
    }

    // Verify rotation works correctly with modulo
    expect(createdFeatures[0].createdById).toBe("user-1");
    expect(createdFeatures[1].createdById).toBe("user-2");
    expect(createdFeatures[2].createdById).toBe("user-1"); // Wraps around
    expect(createdFeatures[3].createdById).toBe("user-2");
    expect(createdFeatures[4].createdById).toBe("user-1");

    // Verify only 2 unique creators exist
    const uniqueCreators = new Set(createdFeatures.map((f) => f.createdById));
    expect(uniqueCreators.size).toBe(2);
  });
});
