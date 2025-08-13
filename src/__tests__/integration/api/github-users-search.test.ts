import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { GET } from "@/app/api/github/users/search/route";
import { db } from "@/lib/db";
import axios from "axios";

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock axios
vi.mock("axios");

// Mock database
vi.mock("@/lib/db", () => ({
  db: {
    account: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock encryption service
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: () => ({
      decryptField: vi.fn().mockReturnValue("mocked-access-token"),
    }),
  },
}));

describe("GitHub Users Search API Integration Tests", () => {
  const mockSession = {
    user: { id: "user1", email: "user@example.com" },
  };

  const mockAccount = {
    userId: "user1",
    provider: "github",
    access_token: "encrypted-token",
  };

  const mockGitHubResponse = {
    data: {
      total_count: 2,
      items: [
        {
          id: 1,
          login: "johndoe",
          avatar_url: "https://avatars.githubusercontent.com/u/1",
          html_url: "https://github.com/johndoe",
          type: "User",
          score: 1.0,
        },
        {
          id: 2,
          login: "johnsmith",
          avatar_url: "https://avatars.githubusercontent.com/u/2",
          html_url: "https://github.com/johnsmith",
          type: "User",
          score: 0.8,
        },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/github/users/search", () => {
    test("should search GitHub users successfully", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (db.account.findFirst as any).mockResolvedValue(mockAccount);
      (axios.get as any).mockResolvedValue(mockGitHubResponse);

      const request = new NextRequest("http://localhost:3000/api/github/users/search?q=john");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.users).toHaveLength(2);
      expect(data.users[0].login).toBe("johndoe");
      expect(data.users[1].login).toBe("johnsmith");
      expect(data.total_count).toBe(2);

      expect(axios.get).toHaveBeenCalledWith(
        "https://api.github.com/search/users",
        {
          headers: {
            Authorization: "token mocked-access-token",
            Accept: "application/vnd.github.v3+json",
          },
          params: {
            q: "john",
            per_page: 10,
          },
        }
      );
    });

    test("should return 401 for unauthenticated user", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/github/users/search?q=john");
      const response = await GET(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    });

    test("should return 400 for missing query parameter", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const request = new NextRequest("http://localhost:3000/api/github/users/search");
      const response = await GET(request);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Search query must be at least 2 characters",
      });
    });

    test("should return 400 for query too short", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const request = new NextRequest("http://localhost:3000/api/github/users/search?q=a");
      const response = await GET(request);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Search query must be at least 2 characters",
      });
    });

    test("should return 400 for missing GitHub access token", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (db.account.findFirst as any).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/github/users/search?q=john");
      const response = await GET(request);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "GitHub access token not found",
      });
    });

    test("should return 401 for expired GitHub token", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (db.account.findFirst as any).mockResolvedValue(mockAccount);
      (axios.get as any).mockRejectedValue({
        response: { status: 401 },
      });

      const request = new NextRequest("http://localhost:3000/api/github/users/search?q=john");
      const response = await GET(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: "GitHub token expired or invalid",
      });
    });

    test("should return 500 for other GitHub API errors", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (db.account.findFirst as any).mockResolvedValue(mockAccount);
      (axios.get as any).mockRejectedValue(new Error("Network error"));

      const request = new NextRequest("http://localhost:3000/api/github/users/search?q=john");
      const response = await GET(request);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "Failed to search GitHub users",
      });
    });

    test("should handle empty search results", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (db.account.findFirst as any).mockResolvedValue(mockAccount);
      (axios.get as any).mockResolvedValue({
        data: {
          total_count: 0,
          items: [],
        },
      });

      const request = new NextRequest("http://localhost:3000/api/github/users/search?q=veryrareusername");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.users).toHaveLength(0);
      expect(data.total_count).toBe(0);
    });
  });
});