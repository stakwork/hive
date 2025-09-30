import { NextRequest } from "next/server";

/**
 * Creates a GET request with optional search parameters
 */
export function createGetRequest(
  url: string,
  searchParams?: Record<string, string>
): NextRequest {
  const fullUrl = searchParams
    ? `${url}?${new URLSearchParams(searchParams).toString()}`
    : url;

  return new NextRequest(fullUrl, {
    method: "GET",
  });
}

/**
 * Creates a POST request with JSON body
 */
export function createPostRequest(
  url: string,
  body: object
): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/**
 * Creates a PUT request with JSON body
 */
export function createPutRequest(
  url: string,
  body: object
): NextRequest {
  return new NextRequest(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/**
 * Creates a DELETE request
 */
export function createDeleteRequest(url: string): NextRequest {
  return new NextRequest(url, {
    method: "DELETE",
  });
}

/**
 * Creates a request with custom headers (for API key auth, etc.)
 */
export function createRequestWithHeaders(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: object
): NextRequest {
  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  return new NextRequest(url, options);
}