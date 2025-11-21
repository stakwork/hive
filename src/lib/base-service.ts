import { HttpClient } from "./http-client";
import { BaseService, ServiceConfig, ApiError } from "@/types";

export abstract class BaseServiceClass implements BaseService {
  protected client: HttpClient;
  protected config: ServiceConfig;
  public abstract readonly serviceName: string;

  constructor(config: ServiceConfig) {
    this.config = config;

    console.log("--------------------------------config--------------------------------");
    console.log(config);
    console.log("--------------------------------config--------------------------------");

    this.client = new HttpClient({
      baseURL: config.baseURL,
      defaultHeaders: {
        Authorization: `Bearer ${config.apiKey}`,
        ...config.headers,
      },
      timeout: config.timeout || 10000,
    });
  }

  getConfig(): ServiceConfig {
    return { ...this.config };
  }

  updateApiKey(apiKey: string): void {
    this.config.apiKey = apiKey;
    this.client.updateApiKey(apiKey);
  }

  protected async handleRequest<T>(requestFn: () => Promise<T>, context: string = "request"): Promise<T> {
    try {
      return await requestFn();
    } catch (error) {
      // Enhance error with service context
      if (error && typeof error === "object" && "status" in error) {
        const apiError = error as ApiError;
        throw {
          ...apiError,
          service: this.serviceName,
          message: `${this.serviceName} ${context}: ${apiError.message}`,
        } as ApiError;
      }

      // Handle unknown errors
      throw {
        message: `${this.serviceName} ${context}: An unexpected error occurred`,
        status: 500,
        service: this.serviceName,
        details: { originalError: error },
      } as ApiError;
    }
  }

  protected getClient(): HttpClient {
    return this.client;
  }
}
