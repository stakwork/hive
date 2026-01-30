import { BaseServiceClass } from "@/lib/base-service";
import { ServiceConfig } from "@/types";
import { config } from "@/config/env";
import { EncryptionService } from "@/lib/encryption";
import { logger } from "@/lib/logger";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export class StakworkService extends BaseServiceClass {
  public readonly serviceName = "stakwork";

  constructor(config: ServiceConfig) {
    super(config);
  }

  async createProject<T = unknown>(input: {
    title: string;
    description: string;
    budget: number;
    skills: string[];
    name: string;
    workflow_id: number;
    workflow_params: { set_var: { attributes: { vars: unknown } } };
  }): Promise<T> {
    const endpoint = `${config.STAKWORK_BASE_URL}/projects`;
    // Compose headers as required by Stakwork
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Token token=${encryptionService.decryptField(
        "stakworkApiKey",
        this.config.apiKey,
      )}`,
    };

    // Use the correct HTTP method
    const client = this.getClient();
    const requestFn = () => {
      return client.post<T>(endpoint, input, headers, this.serviceName);
    };

    return this.handleRequest(requestFn, `stakworkRequest ${endpoint}`);
  }

  /**
   * @param endpoint - API endpoint (e.g., '/projects')
   * @param method - HTTP method (default: 'POST')
   * @param input - Object with fields: name, workflow_id, workflow_params (with set_var/attributes/vars)
   * @returns API response as JSON
   */
  async createCustomer(customerName: string): Promise<unknown> {
    const endpoint = `/customers`;

    const headers = this.config.headers || {
      "Content-Type": "application/json",
    };

    // Use the correct HTTP method
    const client = this.getClient();
    const requestFn = () => {
      return client.post<unknown>(
        endpoint,
        { customer: { name: customerName } },
        headers,
        this.serviceName,
      );
    };

    return this.handleRequest(requestFn, `stakworkRequest ${endpoint}`);
  }

  /**
   * @param endpoint - API endpoint (e.g., '/projects')
   * @param method - HTTP method (default: 'POST')
   * @param input - Object with fields: name, workflow_id, workflow_params (with set_var/attributes/vars)
   * @returns API response as JSON
   */
  async createSecret<T = unknown>(
    name: string,
    value: string,
    token: string,
  ): Promise<T> {
    const endpoint = `/secrets`;

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Token token=${token}`,
    };

    const client = this.getClient();
    const requestFn = () => {
      return client.post<T>(
        endpoint,
        { source: "hive", secret: { name: name, value: value } },
        headers,
        this.serviceName,
      );
    };

    return this.handleRequest(requestFn, `stakworkRequest ${endpoint}`);
  }

  /**
   * Generic helper to make requests to the Stakwork API with required headers and payload structure.
   * @param endpoint - API endpoint (e.g., '/projects')
   * @param method - HTTP method (default: 'POST')
   * @param input - Object with fields: name, workflow_id, workflow_params (with set_var/attributes/vars)
   * @returns API response as JSON
   */
  async stakworkRequest<T = unknown>(
    endpoint: string,
    input: {
      name: string;
      workflow_id: number;
      workflow_params: { set_var: { attributes: { vars: unknown } } };
    },
  ): Promise<T> {
    // Compose headers as required by Stakwork
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Token token=${encryptionService.decryptField(
        "stakworkApiKey",
        this.config.apiKey,
      )}`,
    };

    // Use the correct HTTP method
    const client = this.getClient();
    const requestFn = () => {
      return client.post<T>(endpoint, input, headers, this.serviceName);
    };

    return this.handleRequest(requestFn, `stakworkRequest ${endpoint}`);
  }

  /**
   * Get workflow data for a specific project
   * @param projectId - The Stakwork project ID
   * @returns Workflow data with transitions, connections, and status
   */
  async getWorkflowData(
    projectId: string,
  ): Promise<{ workflowData: unknown; status: string }> {
    const endpoint = `/projects/${projectId}.json`;

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Token token=${encryptionService.decryptField(
        "stakworkApiKey",
        this.config.apiKey,
      )}`,
    };

    const client = this.getClient();
    const requestFn = () => {
      return client.get<{
        success: boolean;
        data: {
          transitions: unknown;
          connections: unknown[];
          project: {
            workflow_state: string;
          };
        };
      }>(
        endpoint,
        headers,
        this.serviceName,
      );
    };

    const response = await this.handleRequest(
      requestFn,
      `stakworkRequest ${endpoint}`,
    );

    return {
      workflowData: response.data,
      status: response.data.project.workflow_state,
    };
  }

  /**
   * Stop a running workflow for a specific project
   * @param projectId - The Stakwork project ID
   * @returns void on success
   */
  async stopWorkflow(projectId: number): Promise<void> {
    const endpoint = `${config.STAKWORK_BASE_URL}/projects/${projectId}/stop`;

    const decryptedApiKey = encryptionService.decryptField(
      "stakworkApiKey",
      this.config.apiKey,
    );

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Token token=${decryptedApiKey}`,
    };

    const client = this.getClient();
    const requestFn = () => {
      return client.post<{ success: boolean }>(
        endpoint,
        {},
        headers,
        this.serviceName,
      );
    };

    try {
      await this.handleRequest(requestFn, `stopWorkflow ${endpoint}`);
      logger.info(`Workflow stopped successfully for project ${projectId}`);
    } catch (error) {
      // Handle errors gracefully - log but don't throw if workflow already stopped
      if (error && typeof error === "object" && "status" in error) {
        const status = (error as { status: number }).status;
        if (status === 404 || status === 410) {
          logger.info(
            `Workflow for project ${projectId} already stopped or not found (status: ${status})`,
          );
          return;
        }
      }
      // Log other errors but still return gracefully
      logger.warn(
        `Failed to stop workflow for project ${projectId}`,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}
