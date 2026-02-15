import { NextRequest } from "next/server";
import { vi } from "vitest";
import { getServerSession as getServerSessionNext } from "next-auth/next";
import { getServerSession as getServerSessionMain } from "next-auth";

export interface InvokeRouteOptions {
  method?: string;
  url?: string;
  session?: unknown;
  body?: unknown;
  headers?: HeadersInit;
  params?: Record<string, string | string[]> | Promise<Record<string, string | string[]>>;
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
  const request = createRequest(options);

  // Mock both next-auth imports since routes use both
  const mockSession = options.session === undefined ? null : options.session;
  vi.mocked(getServerSessionNext).mockResolvedValue(mockSession);
  vi.mocked(getServerSessionMain).mockResolvedValue(mockSession);

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
