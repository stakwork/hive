import { expect } from "vitest";
import type { NextResponse } from "next/server";

/**
 * Assert that a Response is successful and return parsed JSON data
 * @param response - NextResponse or Response object
 * @param expectedStatus - Expected HTTP status code (default: 200)
 * @returns Parsed JSON data from response
 */
export async function expectSuccess<T = any>(
  response: Response | NextResponse,
  expectedStatus: number = 200
): Promise<T> {
  expect(response.status).toBe(expectedStatus);
  const data = await response.json();
  return data as T;
}

/**
 * Assert that a Response contains an error with specific message
 * @param response - NextResponse or Response object
 * @param expectedError - Expected error message (can be partial match)
 * @param expectedStatus - Expected HTTP status code (default: 400)
 */
export async function expectError(
  response: Response | NextResponse,
  expectedError: string | RegExp,
  expectedStatus: number = 400
): Promise<void> {
  expect(response.status).toBe(expectedStatus);
  const data = await response.json();

  if (typeof expectedError === "string") {
    expect(data.error).toContain(expectedError);
  } else {
    expect(data.error).toMatch(expectedError);
  }
}

/**
 * Assert that a Response contains validation errors for specific fields
 * @param response - NextResponse or Response object
 * @param fields - Array of field names that should have validation errors
 */
export async function expectValidationError(
  response: Response | NextResponse,
  fields?: string[]
): Promise<void> {
  expect(response.status).toBe(400);
  const data = await response.json();

  expect(data.error).toBe("Validation failed");

  if (fields && fields.length > 0) {
    expect(data.details).toBeDefined();
    for (const field of fields) {
      expect(data.details).toContain(field);
    }
  }
}

/**
 * Assert that a Response is 401 Unauthorized
 * @param response - NextResponse or Response object
 */
export async function expectUnauthorized(
  response: Response | NextResponse
): Promise<void> {
  expect(response.status).toBe(401);
  const data = await response.json();
  expect(data.error).toBe("Unauthorized");
}

/**
 * Assert that a Response is 403 Forbidden
 * @param response - NextResponse or Response object
 * @param expectedMessage - Optional expected error message
 */
export async function expectForbidden(
  response: Response | NextResponse,
  expectedMessage?: string
): Promise<void> {
  expect(response.status).toBe(403);
  const data = await response.json();

  if (expectedMessage) {
    expect(data.error).toContain(expectedMessage);
  } else {
    expect(data.error).toBeDefined();
  }
}

/**
 * Assert that a Response is 404 Not Found
 * @param response - NextResponse or Response object
 * @param expectedMessage - Optional expected error message
 */
export async function expectNotFound(
  response: Response | NextResponse,
  expectedMessage?: string
): Promise<void> {
  expect(response.status).toBe(404);
  const data = await response.json();

  if (expectedMessage) {
    expect(data.error).toContain(expectedMessage);
  } else {
    expect(data.error).toBeDefined();
  }
}

/**
 * Assert that a Response is 409 Conflict
 * @param response - NextResponse or Response object
 * @param expectedMessage - Optional expected error message
 */
export async function expectConflict(
  response: Response | NextResponse,
  expectedMessage?: string
): Promise<void> {
  expect(response.status).toBe(409);
  const data = await response.json();

  if (expectedMessage) {
    expect(data.error).toContain(expectedMessage);
  } else {
    expect(data.error).toBeDefined();
  }
}