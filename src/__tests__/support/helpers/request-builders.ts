import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

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
export function createDeleteRequest(url: string, body?: object): NextRequest {
  const absoluteUrl = url.startsWith('http') 
    ? url 
    : `http://localhost${url.startsWith('/') ? '' : '/'}${url}`;

  const options: RequestInit = {
    method: "DELETE",
  };

  if (body) {
    options.headers = {
      "Content-Type": "application/json",
    };
    options.body = JSON.stringify(body);
  }

  return new NextRequest(absoluteUrl, options);
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

/**
 * Adds middleware authentication headers to a request
 * Used for testing routes that use middleware context instead of getServerSession
 */
export function addMiddlewareHeaders(
  request: NextRequest,
  user: { id: string; email: string; name: string }
): NextRequest {
  const headers = new Headers(request.headers);
  headers.set(MIDDLEWARE_HEADERS.USER_ID, user.id);
  headers.set(MIDDLEWARE_HEADERS.USER_EMAIL, user.email || "");
  headers.set(MIDDLEWARE_HEADERS.USER_NAME, user.name || "");
  headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
  headers.set(MIDDLEWARE_HEADERS.REQUEST_ID, crypto.randomUUID());

  return new NextRequest(request.url, {
    method: request.method,
    headers,
    body: request.body,
    // @ts-ignore - duplex is needed for body streaming
    duplex: request.body ? "half" : undefined,
  });
}

/**
 * Creates a POST request with middleware auth headers
 */
export function createAuthenticatedPostRequest(
  url: string,
  body: object,
  user: { id: string; email: string; name: string }
): NextRequest {
  const baseRequest = createPostRequest(url, body);
  return addMiddlewareHeaders(baseRequest, user);
}

/**
 * Creates a GET request with middleware auth headers
 */
export function createAuthenticatedGetRequest(
  url: string,
  user: { id: string; email: string; name: string },
  searchParams?: Record<string, string>
): NextRequest {
  const baseRequest = createGetRequest(url, searchParams);
  return addMiddlewareHeaders(baseRequest, user);
}

/**
 * Creates a PATCH request with middleware auth headers
 */
export function createAuthenticatedPatchRequest(
  url: string,
  body: object,
  user: { id: string; email: string; name: string }
): NextRequest {
  const baseRequest = createPatchRequest(url, body);
  return addMiddlewareHeaders(baseRequest, user);
}

/**
 * Creates a DELETE request with middleware auth headers
 */
export function createAuthenticatedDeleteRequest(
  url: string,
  user: { id: string; email: string; name: string }
): NextRequest {
  const baseRequest = createDeleteRequest(url);
  return addMiddlewareHeaders(baseRequest, user);
}

/**
 * Creates a POST request with multipart/form-data for file uploads
 * Used for webhook endpoints that receive files from external services
 */
export function createMultipartPostRequest(
  path: string,
  files: { name: string; content: Buffer; filename: string }[],
  headers: Record<string, string> = {}
): NextRequest {
  const url = path.startsWith('http') 
    ? path 
    : `http://localhost${path.startsWith('/') ? '' : '/'}${path}`;
  const formData = new FormData();

  // Add files to FormData
  files.forEach((file) => {
    const blob = new Blob([file.content], { type: "application/octet-stream" });
    formData.append(file.name, blob, file.filename);
  });

  const request = new NextRequest(url, {
    method: "POST",
    headers: {
      ...headers,
    },
    body: formData as any,
  });

  return request;
}
