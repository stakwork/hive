// Debug test to see the actual response from webhook API
import { POST } from "./src/app/api/github/webhook/ensure/route";
import { vi } from "vitest";

// Mock the authentication to return null (unauthenticated)
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

async function testRequest(body: any) {
  console.log("\n=== Testing request body:", JSON.stringify(body, null, 2));
  
  const request = {
    json: async () => body,
  } as any;

  const { getServerSession } = await import("next-auth");
  (getServerSession as any).mockResolvedValue(null); // Unauthenticated
  
  try {
    const response = await POST(request);
    console.log("Response status:", response.status);
    const responseBody = await response.json();
    console.log("Response body:", JSON.stringify(responseBody, null, 2));
  } catch (error) {
    console.error("Error:", error);
  }
}

async function runTests() {
  // Test unauthorized case
  await testRequest({
    workspaceId: "test-workspace-id",
    repositoryUrl: "https://github.com/test/repo",
  });

  // Test missing fields
  const { getServerSession } = await import("next-auth");
  (getServerSession as any).mockResolvedValue({
    user: { id: "test-user-id" }
  });
  
  await testRequest({
    workspaceId: "test-workspace-id",
    // Missing repositoryUrl/repositoryId
  });
}

runTests();
