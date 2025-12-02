import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/roadmap/features/route";
import { PATCH, DELETE } from "@/app/api/roadmap/features/[featureId]/route";
import { db } from "@/lib/db";
import { FeaturePriority } from "@prisma/client";
import { getServerSession } from "next-auth";
import { vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

describe("Feature API - Priority Integration Tests", () => {
  let testWorkspace: any;
  let testUser: any;

  beforeEach(async () => {
    await db.feature.deleteMany();
    await db.workspaceMember.deleteMany();
    await db.workspace.deleteMany();
    await db.user.deleteMany();

    testUser = await db.user.create({
      data: {
        email: "test@example.com",
        name: "Test User",
      },
    });

    testWorkspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: testUser.id,
        members: {
          create: {
            userId: testUser.id,
            role: "OWNER",
          },
        },
      },
    });

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: testUser.id },
    } as any);
  });

  afterEach(async () => {
    await db.feature.deleteMany();
    await db.workspaceMember.deleteMany();
    await db.workspace.deleteMany();
    await db.user.deleteMany();
    vi.clearAllMocks();
  });

  describe("POST /api/roadmap/features", () => {
    it("should create feature with specified priority", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/roadmap/features",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceId: testWorkspace.id,
            title: "Test Feature",
            description: "Test Description",
            priority: FeaturePriority.HIGH,
          }),
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.priority).toBe(FeaturePriority.HIGH);
      expect(data.title).toBe("Test Feature");
    });

    it("should create feature with default MEDIUM priority when not specified", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/roadmap/features",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceId: testWorkspace.id,
            title: "Test Feature",
            description: "Test Description",
          }),
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.priority).toBe(FeaturePriority.MEDIUM);
    });

    it("should create features with all priority levels", async () => {
      const priorities = [
        FeaturePriority.NONE,
        FeaturePriority.LOW,
        FeaturePriority.MEDIUM,
        FeaturePriority.HIGH,
        FeaturePriority.URGENT,
      ];

      for (const priority of priorities) {
        const request = new NextRequest(
          "http://localhost:3000/api/roadmap/features",
          {
            method: "POST",
            body: JSON.stringify({
              workspaceId: testWorkspace.id,
              title: `Feature with ${priority} priority`,
              priority,
            }),
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(201);
        expect(data.priority).toBe(priority);
      }

      const features = await db.feature.findMany({
        where: { workspaceId: testWorkspace.id },
      });
      expect(features).toHaveLength(5);
    });

    it("should return 400 for invalid priority value", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/roadmap/features",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceId: testWorkspace.id,
            title: "Test Feature",
            priority: "INVALID_PRIORITY",
          }),
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request data");
    });

    it("should persist priority to database correctly", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/roadmap/features",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceId: testWorkspace.id,
            title: "Test Feature",
            priority: FeaturePriority.URGENT,
          }),
        }
      );

      const response = await POST(request);
      const data = await response.json();

      const dbFeature = await db.feature.findUnique({
        where: { id: data.id },
      });

      expect(dbFeature?.priority).toBe(FeaturePriority.URGENT);
    });
  });

  describe("PATCH /api/roadmap/features/[featureId]", () => {
    let testFeature: any;

    beforeEach(async () => {
      testFeature = await db.feature.create({
        data: {
          workspaceId: testWorkspace.id,
          title: "Test Feature",
          brief: "Test Brief",
          priority: FeaturePriority.MEDIUM,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });
    });

    it("should update feature priority", async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/roadmap/features/${testFeature.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            priority: FeaturePriority.HIGH,
          }),
        }
      );

      const response = await PATCH(request, {
        params: { featureId: testFeature.id },
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.priority).toBe(FeaturePriority.HIGH);
      expect(data.title).toBe(testFeature.title);
    });

    it("should update priority from LOW to URGENT", async () => {
      await db.feature.update({
        where: { id: testFeature.id },
        data: { priority: FeaturePriority.LOW },
      });

      const request = new NextRequest(
        `http://localhost:3000/api/roadmap/features/${testFeature.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            priority: FeaturePriority.URGENT,
          }),
        }
      );

      const response = await PATCH(request, {
        params: { featureId: testFeature.id },
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.priority).toBe(FeaturePriority.URGENT);
    });

    it("should update only priority without affecting other fields", async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/roadmap/features/${testFeature.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            priority: FeaturePriority.LOW,
          }),
        }
      );

      const response = await PATCH(request, {
        params: { featureId: testFeature.id },
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.priority).toBe(FeaturePriority.LOW);
      expect(data.title).toBe(testFeature.title);
      expect(data.brief).toBe(testFeature.brief);
    });

    it("should return 400 for invalid priority value", async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/roadmap/features/${testFeature.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            priority: "INVALID",
          }),
        }
      );

      const response = await PATCH(request, {
        params: { featureId: testFeature.id },
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request data");
    });
  });

  describe("GET /api/roadmap/features", () => {
    beforeEach(async () => {
      await db.feature.createMany({
        data: [
          {
            workspaceId: testWorkspace.id,
            title: "Low Priority Feature",
            priority: FeaturePriority.LOW,
            createdById: testUser.id,
            updatedById: testUser.id,
          },
          {
            workspaceId: testWorkspace.id,
            title: "High Priority Feature",
            priority: FeaturePriority.HIGH,
            createdById: testUser.id,
            updatedById: testUser.id,
          },
          {
            workspaceId: testWorkspace.id,
            title: "Urgent Priority Feature",
            priority: FeaturePriority.URGENT,
            createdById: testUser.id,
            updatedById: testUser.id,
          },
        ],
      });
    });

    it("should return all features with their priorities", async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/roadmap/features?workspaceId=${testWorkspace.id}`,
        {
          method: "GET",
        }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveLength(3);
      expect(data.some((f: any) => f.priority === FeaturePriority.LOW)).toBe(true);
      expect(data.some((f: any) => f.priority === FeaturePriority.HIGH)).toBe(true);
      expect(data.some((f: any) => f.priority === FeaturePriority.URGENT)).toBe(
        true
      );
    });

    it("should include priority field in all returned features", async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/roadmap/features?workspaceId=${testWorkspace.id}`,
        {
          method: "GET",
        }
      );

      const response = await GET(request);
      const data = await response.json();

      data.forEach((feature: any) => {
        expect(feature).toHaveProperty("priority");
        expect(Object.values(FeaturePriority)).toContain(feature.priority);
      });
    });
  });
});
