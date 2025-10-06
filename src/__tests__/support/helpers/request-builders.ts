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

  // Ensure absolute URL for NextRequest
  const absoluteUrl = fullUrl.startsWith('http') 
    ? fullUrl 
    : `http://localhost${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}`;

  return new NextRequest(absoluteUrl, {
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
  const absoluteUrl = url.startsWith('http') 
    ? url 
    : `http://localhost${url.startsWith('/') ? '' : '/'}${url}`;
  
  return new NextRequest(absoluteUrl, {
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
  const absoluteUrl = url.startsWith('http') 
    ? url 
    : `http://localhost${url.startsWith('/') ? '' : '/'}${url}`;

  return new NextRequest(absoluteUrl, {
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
  const absoluteUrl = url.startsWith('http') 
    ? url 
    : `http://localhost${url.startsWith('/') ? '' : '/'}${url}`;

  return new NextRequest(absoluteUrl, {
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
  const absoluteUrl = url.startsWith('http') 
    ? url 
    : `http://localhost${url.startsWith('/') ? '' : '/'}${url}`;

  return new NextRequest(absoluteUrl, {
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
  const absoluteUrl = url.startsWith('http') 
    ? url 
    : `http://localhost${url.startsWith('/') ? '' : '/'}${url}`;
  
  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  return new NextRequest(absoluteUrl, options);
}