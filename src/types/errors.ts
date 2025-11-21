export type ErrorKind = "validation" | "forbidden" | "not_found" | "conflict" | "unprocessable_entity" | "server_error";

export interface ApiError {
  kind: ErrorKind;
  message: string;
  statusCode: number;
  details?: unknown;
}

export function isApiError(error: unknown): error is ApiError {
  return typeof error === "object" && error !== null && "kind" in error && "statusCode" in error;
}

export function validationError(message: string, details?: unknown): ApiError {
  return { kind: "validation", message, statusCode: 400, details };
}
export function unauthorizedError(message: string, details?: unknown): ApiError {
  return { kind: "forbidden", message, statusCode: 401, details };
}
export function forbiddenError(message: string, details?: unknown): ApiError {
  return { kind: "forbidden", message, statusCode: 403, details };
}

export function notFoundError(message: string, details?: unknown): ApiError {
  return { kind: "not_found", message, statusCode: 404, details };
}

export function conflictError(message: string, details?: unknown): ApiError {
  return { kind: "conflict", message, statusCode: 409, details };
}

export function unprocessableEntityError(message: string, details?: unknown): ApiError {
  return { kind: "unprocessable_entity", message, statusCode: 422, details };
}

export function serverError(message: string, details?: unknown): ApiError {
  return { kind: "server_error", message, statusCode: 500, details };
}
