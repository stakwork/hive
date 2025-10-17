import { NextRequest } from "next/server";
import { vi } from "vitest";
import { getServerSession } from "next-auth/next";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

export interface InvokeRouteOptions {
  method?: string;
  url?: string;
  session?: unknown;
  body?: unknown;
  headers?: HeadersInit;
  params?: Record<string, string | string[]> | Promise<Record<string, string | string[]>>;
  useMiddlewareAuth?: boolean;
}

export interface InvokeRouteResult {
  response: Response;
  status: number;
  json: <T = unknown>() => Promise<T>;
  text: () => Promise<string>;
}

type RouteHandler = (
  request: NextRequest,
  context?: { params: Promise<Record<string, string | string[]>> },
) => Promise<Response> | Response;

function createRequest({
  method = "GET",
  url = "http://localhost/test",
  body,
  headers,
}: Pick<InvokeRouteOptions, "method" | "url" | "body" | "headers">) {
  if (body === undefined) {
    return new NextRequest(url, { method, headers });
  }

  const payload =
    typeof body === "string" || body instanceof Blob
      ? body
      : JSON.stringify(body);

  const nextHeaders = new Headers(headers);
  if (!nextHeaders.has("Content-Type")) {
    nextHeaders.set("Content-Type", "application/json");
  }

  return new NextRequest(url, {
    method,
    headers: nextHeaders,
    body: payload,
  });
}

export async function invokeRoute(
  handler: RouteHandler,
  options: InvokeRouteOptions = {},
): Promise<InvokeRouteResult> {
  let request = createRequest(options);

  // Support middleware authentication if requested
  if (options.useMiddlewareAuth && options.session) {
    const session = options.session as { user?: { id?: string; email?: string; name?: string } };
    if (session.user) {
      const headers = new Headers(request.headers);
      headers.set(MIDDLEWARE_HEADERS.USER_ID, session.user.id || "");
      headers.set(MIDDLEWARE_HEADERS.USER_EMAIL, session.user.email || "");
      headers.set(MIDDLEWARE_HEADERS.USER_NAME, session.user.name || "");
      headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
      headers.set(MIDDLEWARE_HEADERS.REQUEST_ID, crypto.randomUUID());
      
      request = new NextRequest(request.url, {
        method: request.method,
        headers,
        body: request.body,
        // @ts-ignore - duplex is needed for body streaming
        duplex: request.body ? "half" : undefined,
      });
    }
  } else {
    // Legacy NextAuth session mocking for routes not yet migrated
    vi.mocked(getServerSession).mockResolvedValue(
      options.session === undefined ? null : options.session,
    );
  }

  const context = options.params
    ? {
        params:
          options.params instanceof Promise
            ? options.params
            : Promise.resolve(options.params),
      }
    : undefined;

  const response = await handler(request, context as never);

  return {
    response,
    status: response.status,
    json: (async <T>() => {
      const cloned = response.clone();
      return (await cloned.json()) as T;
    }) as InvokeRouteResult["json"],
    text: async () => {
      const cloned = response.clone();
      return cloned.text();
    },
  };
}
