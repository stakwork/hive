import { NextRequest } from "next/server";

/**
 * Creates a GET request with optional search parameters
 */
export function createGetRequest(
  url: string,
  searchParams?: Record<string, string>
): NextRequest {
  // Ensure URL is absolute - add localhost:3000 if it starts with /
  const baseUrl = url.startsWith('/') ? `http://localhost:3000${url}` : url;
  
  const fullUrl = searchParams
    ? `${baseUrl}?${new URLSearchParams(searchParams).toString()}`
    : baseUrl;

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
  // Ensure URL is absolute - add localhost:3000 if it starts with /
  const baseUrl = url.startsWith('/') ? `http://localhost:3000${url}` : url;
  
  return new NextRequest(baseUrl, {
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
  // Ensure URL is absolute - add localhost:3000 if it starts with /
  const baseUrl = url.startsWith('/') ? `http://localhost:3000${url}` : url;
  
  return new NextRequest(baseUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/**
 * Creates a PATCH request with JSON body
 */
export function createPatchRequest(
  url: string,
  body: object
): NextRequest {
  // Ensure URL is absolute - add localhost:3000 if it starts with /
  const baseUrl = url.startsWith('/') ? `http://localhost:3000${url}` : url;
  
  return new NextRequest(baseUrl, {
    method: "PATCH",
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
  // Ensure URL is absolute - add localhost:3000 if it starts with /
  const baseUrl = url.startsWith('/') ? `http://localhost:3000${url}` : url;
  
  return new NextRequest(baseUrl, {
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
  // Ensure URL is absolute - add localhost:3000 if it starts with /
  const baseUrl = url.startsWith('/') ? `http://localhost:3000${url}` : url;
  
  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  return new NextRequest(baseUrl, options);
}