export interface HttpClientConfig {
  baseURL: string;
  defaultHeaders?: Record<string, string>;
  timeout?: number;
}

export interface ApiError {
  message: string;
  status: number;
  service: string;
  details?: any;
}

export class HttpClient {
  private config: HttpClientConfig;

  constructor(config: HttpClientConfig) {
    this.config = config;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    service: string = "unknown",
  ): Promise<T> {
    const url = `${this.config.baseURL}${endpoint}`;
    console.log("[HttpClient] Requesting:", url);
    const config: RequestInit = {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...this.config.defaultHeaders,
        ...options.headers,
      },
    };

    // RFC 7231 Compliance: GET, HEAD, and OPTIONS requests MUST NOT include a body
    // Strip body from these methods to ensure HTTP specification compliance
    const method = (config.method || "GET").toUpperCase();
    const methodsWithoutBody = ["GET", "HEAD", "OPTIONS"];
    
    if (methodsWithoutBody.includes(method)) {
      if (config.body !== undefined) {
        console.warn(
          `[HttpClient] Warning: ${method} requests cannot include a body (RFC 7231). Body parameter will be ignored.`
        );
        delete config.body;
      }
    }

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeout || 20000,
    );
    config.signal = controller.signal;

    try {
      const response = await fetch(url, config);

      // Clear timeout since request completed
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw {
          message:
            errorData.message || `HTTP error! status: ${response.status}`,
          status: response.status,
          service,
          details: errorData,
        } as ApiError;
      }

      const jsonResponse = await response.json();

      console.log("[HttpClient] RESPONSE:", jsonResponse);

      return jsonResponse;
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle AbortError (timeout)
      if (error instanceof Error && error.name === "AbortError") {
        throw {
          message: "Request timeout",
          status: 408,
          service,
          details: { timeout: this.config.timeout },
        } as ApiError;
      }

      // Handle network errors
      if (error instanceof TypeError) {
        throw {
          message: "Network error - unable to reach the server",
          status: 0,
          service,
          details: { originalError: error.message },
        } as ApiError;
      }

      // Re-throw ApiError
      if (error && typeof error === "object" && "status" in error) {
        throw error as ApiError;
      }

      // Handle unknown errors
      throw {
        message:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
        status: 500,
        service,
        details: { originalError: error },
      } as ApiError;
    }
  }

  async get<T>(
    endpoint: string,
    headers?: Record<string, string>,
    service?: string,
  ): Promise<T> {
    return this.request<T>(endpoint, { method: "GET", headers }, service);
  }

  async post<T>(
    endpoint: string,
    body?: unknown,
    headers?: Record<string, string>,
    service?: string,
  ): Promise<T> {
    console.log("[HttpClient] POST body:", body);

    return this.request<T>(
      endpoint,
      {
        method: "POST",
        body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
        headers,
      },
      service,
    );
  }

  async put<T>(
    endpoint: string,
    body?: unknown,
    headers?: Record<string, string>,
    service?: string,
  ): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: "PUT",
        body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
        headers,
      },
      service,
    );
  }

  async patch<T>(
    endpoint: string,
    body?: unknown,
    headers?: Record<string, string>,
    service?: string,
  ): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: "PATCH",
        body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
        headers,
      },
      service,
    );
  }

  async delete<T>(
    endpoint: string,
    headers?: Record<string, string>,
    service?: string,
  ): Promise<T> {
    return this.request<T>(endpoint, { method: "DELETE", headers }, service);
  }

  // Update API key dynamically
  updateApiKey(apiKey: string): void {
    this.config.defaultHeaders = {
      ...this.config.defaultHeaders,
      Authorization: `Bearer ${apiKey}`,
    };
  }

  // Get current configuration
  getConfig(): HttpClientConfig {
    return { ...this.config };
  }
}
