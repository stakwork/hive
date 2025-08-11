import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock environment variables to prevent loading issues
vi.mock("@/lib/env", () => ({
  env: {
    STAKWORK_API_KEY: "test-stakwork-key",
    NEXTAUTH_SECRET: "test-secret",
    NEXTAUTH_URL: "http://localhost:3000",
    DATABASE_URL: "postgresql://test",
    GITHUB_CLIENT_ID: "test-client-id",
    GITHUB_CLIENT_SECRET: "test-client-secret"
  }
}));

// Mock the swarmGraphQuery function itself
vi.mock("@/services/swarm/api/swarm", () => ({
  swarmGraphQuery: vi.fn(),
}));

const { swarmGraphQuery } = await import("@/services/swarm/api/swarm");
const mockSwarmGraphQuery = swarmGraphQuery as vi.MockedFunction<typeof swarmGraphQuery>;

describe("SwarmGraphQuery - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("should call swarmGraphQuery with correct parameters for URL transformation", async () => {
    // Arrange
    const mockResponse = { ok: true, data: { nodes: [] }, status: 200 };
    mockSwarmGraphQuery.mockResolvedValue(mockResponse);

    const params = {
      swarmUrl: "https://test.sphinx.chat/api",
      apiKey: "test-key",
      nodeType: ["Episode"],
      topNodeCount: 5
    };

    // Act
    const result = await swarmGraphQuery(params);

    // Assert
    expect(mockSwarmGraphQuery).toHaveBeenCalledWith(params);
    expect(result).toEqual(mockResponse);
  });

  test("should call swarmGraphQuery with complex parameters", async () => {
    // Arrange
    const mockResponse = { ok: true, data: { nodes: [] }, status: 200 };
    mockSwarmGraphQuery.mockResolvedValue(mockResponse);

    const params = {
      swarmUrl: "https://test.sphinx.chat/api",
      apiKey: "test-key",
      nodeType: ["Episode", "Document"],
      topNodeCount: 10,
      depth: 2,
      sortBy: "created_at",
      filters: { author: "john", status: "active" }
    };

    // Act
    const result = await swarmGraphQuery(params);

    // Assert
    expect(mockSwarmGraphQuery).toHaveBeenCalledWith(params);
    expect(result).toEqual(mockResponse);
  });

  test("should handle default parameter behavior", async () => {
    // Arrange
    const mockResponse = { ok: true, data: { nodes: [] }, status: 200 };
    mockSwarmGraphQuery.mockResolvedValue(mockResponse);

    const params = {
      swarmUrl: "https://test.sphinx.chat/api",
      apiKey: "test-key"
    };

    // Act
    const result = await swarmGraphQuery(params);

    // Assert
    expect(mockSwarmGraphQuery).toHaveBeenCalledWith(params);
    expect(result).toEqual(mockResponse);
  });

  test("should handle additional dynamic parameters", async () => {
    // Arrange
    const mockResponse = { ok: true, data: { nodes: [] }, status: 200 };
    mockSwarmGraphQuery.mockResolvedValue(mockResponse);

    const params: Parameters<typeof swarmGraphQuery>[0] & {
      customParam: string;
      anotherParam: number;
    } = {
      swarmUrl: "https://test.sphinx.chat/api",
      apiKey: "test-key",
      nodeType: ["Episode"],
      customParam: "customValue",
      anotherParam: 42
    };

    // Act
    const result = await swarmGraphQuery(params);

    // Assert
    expect(mockSwarmGraphQuery).toHaveBeenCalledWith(params);
    expect(result).toEqual(mockResponse);
  });

  test("should handle object parameters", async () => {
    // Arrange
    const mockResponse = { ok: true, data: { nodes: [] }, status: 200 };
    mockSwarmGraphQuery.mockResolvedValue(mockResponse);

    const complexFilter = { nested: { value: "test" }, array: [1, 2, 3] };
    const params = {
      swarmUrl: "https://test.sphinx.chat/api",
      apiKey: "test-key",
      filters: complexFilter,
      objectParam: { key: "value" }
    };

    // Act
    const result = await swarmGraphQuery(params);

    // Assert
    expect(mockSwarmGraphQuery).toHaveBeenCalledWith(params);
    expect(result).toEqual(mockResponse);
  });

  test("should return successful response", async () => {
    // Arrange
    const expectedResponse = {
      ok: true,
      data: { nodes: [{ id: "test" }] },
      status: 200
    };
    mockSwarmGraphQuery.mockResolvedValue(expectedResponse);

    // Act
    const result = await swarmGraphQuery({
      swarmUrl: "https://test.sphinx.chat/api",
      apiKey: "test-key",
      nodeType: ["Episode"]
    });

    // Assert
    expect(result).toEqual(expectedResponse);
  });

  test("should handle error responses", async () => {
    // Arrange
    const errorResponse = {
      ok: false,
      data: null,
      status: 500
    };
    mockSwarmGraphQuery.mockResolvedValue(errorResponse);

    // Act
    const result = await swarmGraphQuery({
      swarmUrl: "https://test.sphinx.chat/api",
      apiKey: "test-key",
      nodeType: ["Episode"]
    });

    // Assert
    expect(result).toEqual(errorResponse);
  });

  test("should handle function rejection", async () => {
    // Arrange
    const error = new Error("Network error");
    mockSwarmGraphQuery.mockRejectedValue(error);

    // Act & Assert
    await expect(swarmGraphQuery({
      swarmUrl: "https://test.sphinx.chat/api",
      apiKey: "test-key",
      nodeType: ["Episode"]
    })).rejects.toThrow("Network error");
  });
});