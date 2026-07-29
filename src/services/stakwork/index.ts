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
        { customer: { name: customerName, create_workflow: true } },
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
    customerId?: string,
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
        {
          source: "hive",
          secret: { name, value },
          ...(customerId ? { customer_id: customerId } : {}),
        },
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
   * Create multiple projects in a single batch request.
   * The caller is responsible for chunking to ≤500 projects per call.
   *
   * @param projects - Array of project definitions (max 500 per call)
   * @returns Batch response with ref_id and per-project results
   */
  async createBatchProjects(
    projects: Array<{
      name: string;
      workflow_id: number;
      webhook_url: string;
      workflow_params: { set_var: { attributes: { vars: unknown } } };
    }>,
  ): Promise<{
    data: {
      ref_id: string;
      projects: Array<{ name: string; project_id?: number; error?: string }>;
    };
  }> {
    const endpoint = `/projects/batch`;

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Token token=${encryptionService.decryptField(
        "stakworkApiKey",
        this.config.apiKey,
      )}`,
    };

    const client = this.getClient();
    const requestFn = () => {
      return client.post<{
        data: {
          ref_id: string;
          projects: Array<{
            name: string;
            project_id?: number;
            error?: string;
          }>;
        };
      }>(endpoint, { projects: projects.map((p) => ({ project: p })) }, headers, this.serviceName);
    };

    return this.handleRequest(requestFn, `stakworkRequest ${endpoint}`);
  }

  /**
   * Stop a running project
   *
   * Stakwork replies HTTP 200 with `{ success: false, errors: "..." }` when it
   * refuses a stop — its `render_error` sets no status code. So a 2xx is NOT
   * evidence the run stopped, and the body has to be inspected. The common
   * refusal is "The project is not running.", raised when the project fails
   * `can_be_stopped?` — only `in_progress` / `new` / `enqueued` are stoppable,
   * so a `stuck`, `paused` or `stopping` project is refused outright.
   *
   * @param projectId - The Stakwork project ID to stop
   * @returns true only when Stakwork accepts; false on refusal or error.
   *          Never throws — callers halt locally regardless of the outcome.
   */
  async stopProject(projectId: number): Promise<boolean> {
    const endpoint = `/projects/${projectId}/stop`;
    logger.info(`[stopProject] Calling senza stop`, "stakwork/stopProject", {
      projectId,
      endpoint,
    });
    try {
      const client = this.getClient();
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Token token=${encryptionService.decryptField(
          "stakworkApiKey",
          this.config.apiKey,
        )}`,
      };
      const requestFn = () =>
        client.post<unknown>(endpoint, {}, headers, this.serviceName);
      const response = await this.handleRequest(requestFn, `stakworkRequest ${endpoint}`);

      const body = response as { success?: boolean; errors?: unknown } | null;
      if (body?.success === false) {
        logger.error(
          `[stopProject] Senza REFUSED the stop — the workflow is still running`,
          "stakwork/stopProject",
          { projectId, errors: body.errors, response },
        );
        return false;
      }

      logger.info(`[stopProject] Senza accepted the stop`, "stakwork/stopProject", {
        projectId,
        response,
      });
      return true;
    } catch (error) {
      logger.error(`[stopProject] Senza stop failed`, "stakwork/stopProject", {
        projectId,
        status: (error as any)?.status,
        message: (error as any)?.message,
        details: (error as any)?.details,
      });
      return false;
    }
  }
}
