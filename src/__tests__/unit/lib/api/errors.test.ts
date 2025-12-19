import { describe, it, expect } from "vitest";
import {
  ApiError,
  ErrorCodes,
  inferApiError,
  formatErrorResponse,
  errorResponse,
} from "@/lib/api/errors";

describe("ApiError", () => {
  describe("constructor", () => {
    it("should create an ApiError with all properties", () => {
      const error = new ApiError(
        ErrorCodes.BAD_REQUEST,
        "Invalid input",
        400,
        { field: "email" }
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.name).toBe("ApiError");
      expect(error.code).toBe(ErrorCodes.BAD_REQUEST);
      expect(error.message).toBe("Invalid input");
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({ field: "email" });
    });

    it("should create an ApiError without details", () => {
      const error = new ApiError(ErrorCodes.NOT_FOUND, "Not found", 404);

      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toBe("Not found");
      expect(error.statusCode).toBe(404);
      expect(error.details).toBeUndefined();
    });
  });

  describe("static factory methods", () => {
    it("should create unauthorized error with default message", () => {
      const error = ApiError.unauthorized();

      expect(error.code).toBe(ErrorCodes.UNAUTHORIZED);
      expect(error.message).toBe("Unauthorized");
      expect(error.statusCode).toBe(401);
    });

    it("should create unauthorized error with custom message", () => {
      const error = ApiError.unauthorized("Token expired");

      expect(error.message).toBe("Token expired");
      expect(error.statusCode).toBe(401);
    });

    it("should create forbidden error with details", () => {
      const error = ApiError.forbidden("Access denied", { requiredRole: "ADMIN" });

      expect(error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(error.message).toBe("Access denied");
      expect(error.statusCode).toBe(403);
      expect(error.details).toEqual({ requiredRole: "ADMIN" });
    });

    it("should create notFound error", () => {
      const error = ApiError.notFound("User not found");

      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toBe("User not found");
      expect(error.statusCode).toBe(404);
    });

    it("should create badRequest error", () => {
      const error = ApiError.badRequest("Missing field", { field: "name" });

      expect(error.code).toBe(ErrorCodes.BAD_REQUEST);
      expect(error.message).toBe("Missing field");
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({ field: "name" });
    });

    it("should create conflict error", () => {
      const error = ApiError.conflict("Email already exists");

      expect(error.code).toBe(ErrorCodes.CONFLICT);
      expect(error.message).toBe("Email already exists");
      expect(error.statusCode).toBe(409);
    });

    it("should create internal error", () => {
      const error = ApiError.internal("Database connection failed");

      expect(error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(error.message).toBe("Database connection failed");
      expect(error.statusCode).toBe(500);
    });

    it("should create validation error", () => {
      const error = ApiError.validation("Invalid email format", { email: "invalid" });

      expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(error.message).toBe("Invalid email format");
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({ email: "invalid" });
    });
  });
});

describe("inferApiError", () => {
  it("should return the same error if already an ApiError", () => {
    const apiError = ApiError.notFound("Resource not found");
    const result = inferApiError(apiError);

    expect(result).toBe(apiError);
  });

  it("should infer not found error from message", () => {
    const error = new Error("User not found");
    const result = inferApiError(error);

    expect(result.code).toBe(ErrorCodes.NOT_FOUND);
    expect(result.message).toBe("User not found");
    expect(result.statusCode).toBe(404);
  });

  it("should infer forbidden error from 'access denied'", () => {
    const error = new Error("Access denied to resource");
    const result = inferApiError(error);

    expect(result.code).toBe(ErrorCodes.FORBIDDEN);
    expect(result.statusCode).toBe(403);
  });

  it("should infer forbidden error from 'forbidden'", () => {
    const error = new Error("Forbidden action");
    const result = inferApiError(error);

    expect(result.code).toBe(ErrorCodes.FORBIDDEN);
    expect(result.statusCode).toBe(403);
  });

  it("should infer unauthorized error from message", () => {
    const error = new Error("Unauthorized access");
    const result = inferApiError(error);

    expect(result.code).toBe(ErrorCodes.UNAUTHORIZED);
    expect(result.statusCode).toBe(401);
  });

  it("should infer bad request from 'invalid'", () => {
    const error = new Error("Invalid input");
    const result = inferApiError(error);

    expect(result.code).toBe(ErrorCodes.BAD_REQUEST);
    expect(result.statusCode).toBe(400);
  });

  it("should infer bad request from 'required'", () => {
    const error = new Error("Name is required");
    const result = inferApiError(error);

    expect(result.code).toBe(ErrorCodes.BAD_REQUEST);
    expect(result.statusCode).toBe(400);
  });

  it("should infer bad request from 'must be'", () => {
    const error = new Error("Value must be positive");
    const result = inferApiError(error);

    expect(result.code).toBe(ErrorCodes.BAD_REQUEST);
    expect(result.statusCode).toBe(400);
  });

  it("should infer bad request from 'validation'", () => {
    const error = new Error("Validation failed");
    const result = inferApiError(error);

    expect(result.code).toBe(ErrorCodes.BAD_REQUEST);
    expect(result.statusCode).toBe(400);
  });

  it("should infer conflict from 'already exists'", () => {
    const error = new Error("Email already exists");
    const result = inferApiError(error);

    expect(result.code).toBe(ErrorCodes.CONFLICT);
    expect(result.statusCode).toBe(409);
  });

  it("should infer conflict from 'conflict'", () => {
    const error = new Error("Resource conflict detected");
    const result = inferApiError(error);

    expect(result.code).toBe(ErrorCodes.CONFLICT);
    expect(result.statusCode).toBe(409);
  });

  it("should default to internal error for unrecognized pattern", () => {
    const error = new Error("Something went wrong");
    const result = inferApiError(error);

    expect(result.code).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(result.message).toBe("Something went wrong");
    expect(result.statusCode).toBe(500);
  });

  it("should handle unknown error types", () => {
    const result = inferApiError("string error");

    expect(result.code).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(result.message).toBe("An unexpected error occurred");
    expect(result.statusCode).toBe(500);
  });

  it("should be case-insensitive when matching patterns", () => {
    const error1 = new Error("NOT FOUND");
    const error2 = new Error("Access DENIED");
    const error3 = new Error("INVALID input");

    expect(inferApiError(error1).code).toBe(ErrorCodes.NOT_FOUND);
    expect(inferApiError(error2).code).toBe(ErrorCodes.FORBIDDEN);
    expect(inferApiError(error3).code).toBe(ErrorCodes.BAD_REQUEST);
  });
});

describe("formatErrorResponse", () => {
  it("should format error without details", () => {
    const error = ApiError.notFound("Resource not found");
    const response = formatErrorResponse(error);

    expect(response).toEqual({
      success: false,
      error: {
        code: ErrorCodes.NOT_FOUND,
        message: "Resource not found",
      },
    });
  });

  it("should format error with details", () => {
    const error = ApiError.badRequest("Invalid field", { field: "email" });
    const response = formatErrorResponse(error);

    expect(response).toEqual({
      success: false,
      error: {
        code: ErrorCodes.BAD_REQUEST,
        message: "Invalid field",
        details: { field: "email" },
      },
    });
  });

  it("should ignore requestId parameter (for future use)", () => {
    const error = ApiError.unauthorized();
    const response = formatErrorResponse(error, "req-123");

    expect(response).toEqual({
      success: false,
      error: {
        code: ErrorCodes.UNAUTHORIZED,
        message: "Unauthorized",
      },
    });
  });
});

describe("errorResponse", () => {
  it("should create NextResponse with correct status code", () => {
    const error = ApiError.notFound("User not found");
    const response = errorResponse(error);

    expect(response.status).toBe(404);
  });

  it("should include error payload in JSON", async () => {
    const error = ApiError.badRequest("Invalid input", { field: "name" });
    const response = errorResponse(error);

    const json = await response.json();
    expect(json).toEqual({
      success: false,
      error: {
        code: ErrorCodes.BAD_REQUEST,
        message: "Invalid input",
        details: { field: "name" },
      },
    });
  });

  it("should set x-request-id header when provided", () => {
    const error = ApiError.internal();
    const response = errorResponse(error, "req-12345");

    expect(response.headers.get("x-request-id")).toBe("req-12345");
  });

  it("should not set x-request-id header when not provided", () => {
    const error = ApiError.internal();
    const response = errorResponse(error);

    expect(response.headers.get("x-request-id")).toBeNull();
  });

  it("should handle all error codes with correct status codes", async () => {
    const testCases = [
      { error: ApiError.unauthorized(), expectedStatus: 401 },
      { error: ApiError.forbidden(), expectedStatus: 403 },
      { error: ApiError.notFound(), expectedStatus: 404 },
      { error: ApiError.badRequest(), expectedStatus: 400 },
      { error: ApiError.conflict(), expectedStatus: 409 },
      { error: ApiError.internal(), expectedStatus: 500 },
      { error: ApiError.validation(), expectedStatus: 400 },
    ];

    for (const { error, expectedStatus } of testCases) {
      const response = errorResponse(error);
      expect(response.status).toBe(expectedStatus);
      
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe(error.code);
    }
  });
});
