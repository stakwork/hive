export interface ApiError {
  message: string;
  status: 400 | 401 | 403 | 404 | 408 | 409 | 422 | 500 | 503;
  details?: unknown;
}

export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "message" in error &&
    typeof (error as ApiError).status === "number"
  );
}
export const badRequest = (message: string, details?: unknown): ApiError => ({
  message,
  status: 400 as const,
  details,
});

export const unauthorized = (message: string, details?: unknown): ApiError => ({
  message,
  status: 401 as const,
  details,
});

export const forbidden = (message: string, details?: unknown): ApiError => ({
  message,
  status: 403 as const,
  details,
});

export const notFound = (message: string, details?: unknown): ApiError => ({
  message,
  status: 404 as const,
  details,
});

export const timeout = (message: string, details?: unknown): ApiError => ({
  message,
  status: 408 as const,
  details,
});

export const conflict = (message: string, details?: unknown): ApiError => ({
  message,
  status: 409 as const,
  details,
});

export const unprocessableEntity = (message: string, details?: unknown): ApiError => ({
  message,
  status: 422 as const,
  details,
});

export const serverError = (message: string, details?: unknown): ApiError => ({
  message,
  status: 500 as const,
  details,
});

export const serviceUnavailable = (message: string, details?: unknown): ApiError => ({
  message,
  status: 503 as const,
  details,
});
