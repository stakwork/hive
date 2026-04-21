import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/workspaces/[slug]/voice-signatures/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
} from "@/__tests__/support/factories";
import {
  createAuthenticatedGetRequest,
  createGetRequest,
} from "@/__tests__/support/helpers/request-builders";

// Mock S3Service
vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(() => ({
    generatePresignedDownloadUrl: vi.fn(async (key: string) => 
      `https://presigned.example.com/${key}`
    ),
  })),
}));

describe("Voice Signatures API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set test API token
    process.env.API_TOKEN = "test-token";
  });

  describe("GET /api/workspaces/[slug]/voice-signatures", () => {
    describe("Authentication", () => {
      // Voice signatures are biometric data — the handler resolves access
      // via `resolveWorkspaceAccess`, which returns a unified 404
      // "Workspace not found or access denied" whenever the caller is
      // unauthenticated (or the x-api-token is invalid). We never emit
      // a distinct 401, to avoid revealing workspace existence.
      test("returns 404 when no auth is provided (no session, no token)", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });

        try {
          const request = createGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/voice-signatures`
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          expect(response.status).toBe(404);
          const data = await response.json();
          expect(data.message).toBe("Workspace not found or access denied");
        } finally {
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.delete({ where: { id: owner.id } });
        }
      });

      test("returns 404 with invalid x-api-token header", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });

        try {
          const baseRequest = createGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/voice-signatures`
          );

          // Add invalid API token header
          const headers = new Headers(baseRequest.headers);
          headers.set("x-api-token", "invalid-token");

          const request = new Request(baseRequest.url, {
            method: baseRequest.method,
            headers,
          });

          const response = await GET(request as any, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          // Invalid tokens fall through to the session path, which in turn
          // resolves to a unified 404.
          expect(response.status).toBe(404);
          const data = await response.json();
          expect(data.message).toBe("Workspace not found or access denied");
        } finally {
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.delete({ where: { id: owner.id } });
        }
      });

      test("returns 200 with valid x-api-token header", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });

        // Set voice signature on owner
        await db.user.update({
          where: { id: owner.id },
          data: { voiceSignatureKey: "voice-signatures/owner-signature.wav" },
        });

        try {
          const baseRequest = createGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/voice-signatures`
          );
          
          // Add valid API token header
          const headers = new Headers(baseRequest.headers);
          headers.set("x-api-token", "test-token");
          
          const request = new Request(baseRequest.url, {
            method: baseRequest.method,
            headers,
          });

          const response = await GET(request as any, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          expect(response.status).toBe(200);
          const data = await response.json();
          expect(data).toHaveProperty("speakers");
          expect(Array.isArray(data.speakers)).toBe(true);
          expect(data.speakers.length).toBe(1);
          expect(data.speakers[0].label).toBe(owner.id);
        } finally {
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.delete({ where: { id: owner.id } });
        }
      });

      test("returns 200 with valid session auth (fallback path)", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });

        // Set voice signature on owner
        await db.user.update({
          where: { id: owner.id },
          data: { voiceSignatureKey: "voice-signatures/owner-signature.wav" },
        });

        try {
          const request = createAuthenticatedGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/voice-signatures`,
            owner
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          expect(response.status).toBe(200);
          const data = await response.json();
          expect(data).toHaveProperty("speakers");
          expect(Array.isArray(data.speakers)).toBe(true);
          expect(data.speakers.length).toBe(1);
          expect(data.speakers[0].label).toBe(owner.id);
        } finally {
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.delete({ where: { id: owner.id } });
        }
      });
    });

    describe("Workspace Validation", () => {
      test("returns 404 for unknown workspace slug", async () => {
        const owner = await createTestUser();

        try {
          const request = createAuthenticatedGetRequest(
            "http://localhost:3000/api/workspaces/nonexistent-slug/voice-signatures",
            owner
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: "nonexistent-slug" }),
          });

          expect(response.status).toBe(404);
          const data = await response.json();
          expect(data.success).toBe(false);
          expect(data.message).toBe("Workspace not found");
        } finally {
          await db.user.delete({ where: { id: owner.id } });
        }
      });
    });

    describe("Voice Signature Filtering", () => {
      test("workspace owner with voice signature is included in speakers", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });

        // Set voice signature on owner
        await db.user.update({
          where: { id: owner.id },
          data: { voiceSignatureKey: "voice-signatures/owner-signature.wav" },
        });

        try {
          const request = createAuthenticatedGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/voice-signatures`,
            owner
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          expect(response.status).toBe(200);
          const data = await response.json();
          expect(data.speakers).toHaveLength(1);
          expect(data.speakers[0].label).toBe(owner.id);
          expect(data.speakers[0].name).toBe(owner.name);
          expect(data.speakers[0].audio_filepath).toContain("voice-signatures/owner-signature.wav");
        } finally {
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.delete({ where: { id: owner.id } });
        }
      });

      test("member without voice signature is excluded from speakers", async () => {
        const owner = await createTestUser();
        const memberWithSignature = await createTestUser({ email: "member1@example.com" });
        const memberWithoutSignature = await createTestUser({ email: "member2@example.com" });
        const workspace = await createTestWorkspace({ ownerId: owner.id });

        // Set voice signature only on memberWithSignature
        await db.user.update({
          where: { id: memberWithSignature.id },
          data: { voiceSignatureKey: "voice-signatures/member1-signature.wav" },
        });

        // Create memberships
        await createTestMembership({
          workspaceId: workspace.id,
          userId: memberWithSignature.id,
          role: "DEVELOPER",
        });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: memberWithoutSignature.id,
          role: "DEVELOPER",
        });

        try {
          const request = createAuthenticatedGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/voice-signatures`,
            owner
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          expect(response.status).toBe(200);
          const data = await response.json();
          expect(data.speakers).toHaveLength(1);
          expect(data.speakers[0].label).toBe(memberWithSignature.id);
          expect(data.speakers.some((s: any) => s.label === memberWithoutSignature.id)).toBe(false);
        } finally {
          await db.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.deleteMany({
            where: { id: { in: [owner.id, memberWithSignature.id, memberWithoutSignature.id] } },
          });
        }
      });

      test("returns only members with voiceSignatureKey set", async () => {
        const owner = await createTestUser();
        const member1 = await createTestUser({ email: "member1@example.com" });
        const member2 = await createTestUser({ email: "member2@example.com" });
        const workspace = await createTestWorkspace({ ownerId: owner.id });

        // Set voice signatures on owner and member1
        await db.user.update({
          where: { id: owner.id },
          data: { voiceSignatureKey: "voice-signatures/owner-signature.wav" },
        });
        await db.user.update({
          where: { id: member1.id },
          data: { voiceSignatureKey: "voice-signatures/member1-signature.wav" },
        });

        // Create memberships
        await createTestMembership({
          workspaceId: workspace.id,
          userId: member1.id,
          role: "DEVELOPER",
        });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: member2.id,
          role: "DEVELOPER",
        });

        try {
          const request = createAuthenticatedGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/voice-signatures`,
            owner
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          expect(response.status).toBe(200);
          const data = await response.json();
          expect(data.speakers).toHaveLength(2);
          
          const labels = data.speakers.map((s: any) => s.label);
          expect(labels).toContain(owner.id);
          expect(labels).toContain(member1.id);
          expect(labels).not.toContain(member2.id);
        } finally {
          await db.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.deleteMany({
            where: { id: { in: [owner.id, member1.id, member2.id] } },
          });
        }
      });
    });

    describe("Response Format", () => {
      test("response shape matches NeMo enrollment manifest format", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });

        // Set voice signature on owner
        await db.user.update({
          where: { id: owner.id },
          data: { voiceSignatureKey: "voice-signatures/owner-signature.wav" },
        });

        try {
          const request = createAuthenticatedGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/voice-signatures`,
            owner
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          expect(response.status).toBe(200);
          const data = await response.json();

          // Verify top-level structure
          expect(data).toHaveProperty("speakers");
          expect(Array.isArray(data.speakers)).toBe(true);

          // Verify speaker entry structure
          const speaker = data.speakers[0];
          expect(speaker).toHaveProperty("audio_filepath");
          expect(speaker).toHaveProperty("duration");
          expect(speaker).toHaveProperty("label");
          expect(speaker).toHaveProperty("name");

          // Verify field values
          expect(typeof speaker.audio_filepath).toBe("string");
          expect(speaker.audio_filepath).toContain("https://presigned.example.com/");
          expect(speaker.duration).toBeNull();
          expect(speaker.label).toBe(owner.id);
          expect(speaker.name).toBe(owner.name);
        } finally {
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.delete({ where: { id: owner.id } });
        }
      });

      test("returns empty speakers array when no members have voice signatures", async () => {
        const owner = await createTestUser();
        const member = await createTestUser({ email: "member@example.com" });
        const workspace = await createTestWorkspace({ ownerId: owner.id });

        // Create membership without voice signatures
        await createTestMembership({
          workspaceId: workspace.id,
          userId: member.id,
          role: "DEVELOPER",
        });

        try {
          const request = createAuthenticatedGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/voice-signatures`,
            owner
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          expect(response.status).toBe(200);
          const data = await response.json();
          expect(data.speakers).toHaveLength(0);
        } finally {
          await db.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.deleteMany({ where: { id: { in: [owner.id, member.id] } } });
        }
      });
    });
  });
});
