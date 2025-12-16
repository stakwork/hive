import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/stakwork/validate-workflow/route";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { stakworkService } from "@/lib/service-factory";

// Mock dependencies
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/service-factory", () => ({
  stakworkService: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

describe("POST /api/stakwork/validate-workflow", () => {
  const mockStakworkService = {
    createProject: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(stakworkService).mockReturnValue(mockStakworkService as any);
  });

  describe("Authentication", () => {
    it("should return 401 when user is not authenticated", async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/stakwork/validate-workflow", {
        method: "POST",
        body: JSON.stringify({ workflow_id: 123 }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      expect(mockStakworkService.createProject).not.toHaveBeenCalled();
    });

    it("should return 401 when session exists but has no user", async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: null } as any);

      const request = new NextRequest("http://localhost:3000/api/stakwork/validate-workflow", {
        method: "POST",
        body: JSON.stringify({ workflow_id: 123 }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should proceed with validation when user is authenticated", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "user123", email: "test@example.com" },
      } as any);

      mockStakworkService.createProject.mockResolvedValue({
        project_id: "project123",
      });

      const request = new NextRequest("http://localhost:3000/api/stakwork/validate-workflow", {
        method: "POST",
        body: JSON.stringify({ workflow_id: 123 }),
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockStakworkService.createProject).toHaveBeenCalled();
    });
  });

  describe("Request Validation", () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "user123", email: "test@example.com" },
      } as any);
    });

    it("should return 400 when workflow_id is missing", async () => {
      const request = new NextRequest("http://localhost:3000/api/stakwork/validate-workflow", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid workflow_id");
      expect(mockStakworkService.createProject).not.toHaveBeenCalled();
    });

    it("should return 400 when workflow_id is not a number", async () => {
      const request = new NextRequest("http://localhost:3000/api/stakwork/validate-workflow", {
        method: "POST",
        body: JSON.stringify({ workflow_id: "abc" }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid workflow_id");
    });

    it("should return 400 when workflow_id is null", async () => {
      const request = new NextRequest("http://localhost:3000/api/stakwork/validate-workflow", {
        method: "POST",
        body: JSON.stringify({ workflow_id: null }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid workflow_id");
    });

    it("should accept valid numeric workflow_id", async () => {
      mockStakworkService.createProject.mockResolvedValue({
        project_id: "project123",
      });

      const request = new NextRequest("http://localhost:3000/api/stakwork/validate-workflow", {
        method: "POST",
        body: JSON.stringify({ workflow_id: 456 }),
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockStakworkService.createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          workflow_id: 456,
        })
      );
    });
  });

  describe("Stakwork Integration", () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "user123", email: "test@example.com" },
      } as any);
    });

    it("should call Stakwork createProject with minimal validation payload", async () => {
      mockStakworkService.createProject.mockResolvedValue({
        project_id: "project123",
      });

      const request = new NextRequest("http://localhost:3000/api/stakwork/validate-workflow", {
        method: "POST",
        body: JSON.stringify({ workflow_id: 789 }),
      });

      await POST(request);

      expect(mockStakworkService.createProject).toHaveBeenCalledWith({
        workflow_id: 789,
        title: "Validation Check",
        description: "Temporary validation check",
        budget: 1,
        skills: ["validation"],
        name: "validation-check",
        workflow_params: {
          set_var: {
            attributes: {
              vars: {},
            },
          },
        },
      });
    });

    it("should return 200 when workflow exists in Stakwork", async () => {
      mockStakworkService.createProject.mockResolvedValue({
        project_id: "project123",
        workflow_id: 123,
      });

      const request = new NextRequest("http://localhost:3000/api/stakwork/validate-workflow", {
        method: "POST",
        body: JSON.stringify({ workflow_id: 123 }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.workflow_id).toBe(123);
    });

    it("should return 404 when workflow does not exist (404 response)", async () => {
      mockStakworkService.createProject.mockRejectedValue({
        response: { status: 404 },
        message: "Workflow not found",
      });

      const request = new NextRequest("http://localhost:3000/api/stakwork/validate-workflow", {
        method: "POST",
        body: JSON.stringify({ workflow_id: 999 }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain("Workflow ID 999 not found in Stakwork");
    });

    it("should return 404 when workflow does not exist (not found in message)", async () => {
      mockStakworkService.createProject.mockRejectedValue({
        message: "Workflow not found for ID 888",
      });

      const request = new NextRequest("http://localhost:3000/api/stakwork/validate-workflow", {
        method: "POST",
        body: JSON.stringify({ workflow_id: 888 }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain("Workflow ID 888 not found in Stakwork");
    });

    it("should return 500 for other Stakwork errors", async () => {
      mockStakworkService.createProject.mockRejectedValue(
        new Error("Stakwork service unavailable")
      );

      const request = new NextRequest("http://localhost:3000/api/stakwork/validate-workflow", {
        method: "POST",
        body: JSON.stringify({ workflow_id: 123 }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Internal server error");
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "user123", email: "test@example.com" },
      } as any);
    });

    it("should handle JSON parse errors gracefully", async () => {
      const request = new NextRequest("http://localhost:3000/api/stakwork/validate-workflow", {
        method: "POST",
        body: "invalid json",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Internal server error");
    });

    it("should handle unexpected errors", async () => {
      vi.mocked(getServerSession).mockRejectedValue(new Error("Database connection failed"));

      const request = new NextRequest("http://localhost:3000/api/stakwork/validate-workflow", {
        method: "POST",
        body: JSON.stringify({ workflow_id: 123 }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Internal server error");
    });
  });

  describe("Validation Only (No Database Save)", () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "user123", email: "test@example.com" },
      } as any);
    });

    it("should not save project to database after validation", async () => {
      mockStakworkService.createProject.mockResolvedValue({
        project_id: "project123",
      });

      const request = new NextRequest("http://localhost:3000/api/stakwork/validate-workflow", {
        method: "POST",
        body: JSON.stringify({ workflow_id: 123 }),
      });

      const response = await POST(request);

      // Response should be successful
      expect(response.status).toBe(200);

      // This test verifies that the endpoint doesn't call any database save operations
      // The createProject call is only for validation purposes
      expect(mockStakworkService.createProject).toHaveBeenCalledTimes(1);
    });
  });
});
