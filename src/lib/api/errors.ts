import { NextResponse } from "next/server";
import type { ApiErrorResponse } from "./types";

/**
 * Standardized error codes for API responses
 */
export const ErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  BAD_REQUEST: "BAD_REQUEST",
  CONFLICT: "CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_ERROR: "SERVICE_ERROR",
  VALIDATION_ERROR: "VALIDATION_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Custom error class for API errors
 * Provides structured error information with HTTP status codes
 */
export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }

  static unauthorized(message = "Unauthorized", details?: Record<string, unknown>): ApiError {
    return new ApiError(ErrorCodes.UNAUTHORIZED, message, 401, details);
  }

  static forbidden(message = "Forbidden", details?: Record<string, unknown>): ApiError {
    return new ApiError(ErrorCodes.FORBIDDEN, message, 403, details);
  }

  static notFound(message = "Not found", details?: Record<string, unknown>): ApiError {
    return new ApiError(ErrorCodes.NOT_FOUND, message, 404, details);
  }

  static badRequest(message = "Bad request", details?: Record<string, unknown>): ApiError {
    return new ApiError(ErrorCodes.BAD_REQUEST, message, 400, details);
  }

  static conflict(message = "Conflict", details?: Record<string, unknown>): ApiError {
    return new ApiError(ErrorCodes.CONFLICT, message, 409, details);
  }

  static internal(message = "Internal server error", details?: Record<string, unknown>): ApiError {
    return new ApiError(ErrorCodes.INTERNAL_ERROR, message, 500, details);
  }

  static validation(message = "Validation error", details?: Record<string, unknown>): ApiError {
    return new ApiError(ErrorCodes.VALIDATION_ERROR, message, 400, details);
  }
}

/**
 * Infer API error from service-layer errors
 * Converts legacy Error objects to structured ApiError based on message patterns
 * 
 * @param error - Unknown error from service layer
 * @returns Structured ApiError with appropriate status code
 */
export function inferApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Pattern matching on error messages (legacy service layer compatibility)
    if (message.includes("not found")) {
      return ApiError.notFound(error.message);
    }
    if (message.includes("access denied") || message.includes("forbidden")) {
      return ApiError.forbidden(error.message);
    }
    if (message.includes("unauthorized")) {
      return ApiError.unauthorized(error.message);
    }
    if (
      message.includes("invalid") ||
      message.includes("required") ||
      message.includes("must be") ||
      message.includes("validation")
    ) {
      return ApiError.badRequest(error.message);
    }
    if (message.includes("already exists") || message.includes("conflict")) {
      return ApiError.conflict(error.message);
    }

    // Default to internal error for unrecognized patterns
    return ApiError.internal(error.message);
  }

  // Unknown error type
  return ApiError.internal("An unexpected error occurred");
}

/**
 * Format API error as standardized response object
 * 
 * @param error - ApiError to format
 * @param requestId - Optional request ID for tracing
 * @returns Formatted error response
 */
export function formatErrorResponse(error: ApiError, requestId?: string): ApiErrorResponse {
  return {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details && { details: error.details }),
    },
  };
}

/**
 * Create NextResponse from ApiError with proper status code and headers
 * 
 * @param error - ApiError to convert to response
 * @param requestId - Optional request ID for x-request-id header
 * @returns NextResponse with error payload
 */
export function errorResponse(error: ApiError, requestId?: string): NextResponse<ApiErrorResponse> {
  const response = NextResponse.json(formatErrorResponse(error, requestId), {
    status: error.statusCode,
  });

  if (requestId) {
    response.headers.set("x-request-id", requestId);
  }

  return response;
}