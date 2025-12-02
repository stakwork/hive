interface MockStakworkProject {
  id: number;
  name: string;
  workflow_id: number;
  workflow_state: "pending" | "running" | "complete" | "failed";
  transitions: unknown;
  connections: unknown[];
  workflow_params: unknown;
  createdAt: Date;
  completionTimer?: NodeJS.Timeout;
}

interface MockStakworkCustomer {
  id: string;
  name: string;
  token: string;
  createdAt: Date;
}

interface MockStakworkSecret {
  name: string;
  value: string;
  createdAt: Date;
}

class MockStakworkStateManager {
  private projects: Map<number, MockStakworkProject> = new Map();
  private customers: Map<string, MockStakworkCustomer> = new Map();
  private secrets: Map<string, MockStakworkSecret> = new Map();
  private projectIdCounter = 10000;
  private customerIdCounter = 1;
  private webhookCallbacks: Map<number, string> = new Map();

  createProject(input: {
    name: string;
    workflow_id: number;
    workflow_params: unknown;
  }): { project_id: number } {
    const projectId = this.projectIdCounter++;

    const project: MockStakworkProject = {
      id: projectId,
      name: input.name,
      workflow_id: input.workflow_id,
      workflow_state: "pending",
      transitions: {},
      connections: [],
      workflow_params: input.workflow_params,
      createdAt: new Date(),
    };

    this.projects.set(projectId, project);

    return { project_id: projectId };
  }

  getProject(projectId: number): MockStakworkProject | undefined {
    return this.projects.get(projectId);
  }

  progressWorkflow(projectId: number, webhookUrl?: string): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    if (webhookUrl) {
      this.webhookCallbacks.set(projectId, webhookUrl);
    }

    project.workflow_state = "running";
    this.triggerWebhook(projectId, "running");

    project.completionTimer = setTimeout(() => {
      project.workflow_state = "complete";
      this.triggerWebhook(projectId, "complete");

      if (project.completionTimer) {
        clearTimeout(project.completionTimer);
        delete project.completionTimer;
      }
    }, 3000);
  }

  private async triggerWebhook(
    projectId: number,
    status: string
  ): Promise<void> {
    const webhookUrl = this.webhookCallbacks.get(projectId);
    if (!webhookUrl) return;

    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_status: status,
          task_id: null,
          project_id: projectId,
        }),
      });
    } catch (error) {
      console.error(
        `Failed to trigger webhook for project ${projectId}:`,
        error
      );
    }
  }

  createCustomer(name: string): {
    customer: { id: string; name: string; token: string };
  } {
    const existing = this.customers.get(name);
    if (existing) {
      return {
        customer: {
          id: existing.id,
          name: existing.name,
          token: existing.token,
        },
      };
    }

    const customer: MockStakworkCustomer = {
      id: `customer_${this.customerIdCounter++}`,
      name,
      token: `mock_token_${Math.random().toString(36).substring(7)}`,
      createdAt: new Date(),
    };

    this.customers.set(name, customer);

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        token: customer.token,
      },
    };
  }

  getCustomer(name: string): MockStakworkCustomer | undefined {
    return this.customers.get(name);
  }

  createSecret(name: string, value: string): { success: boolean } {
    const secret: MockStakworkSecret = {
      name,
      value,
      createdAt: new Date(),
    };

    this.secrets.set(name, secret);

    return { success: true };
  }

  getSecret(name: string): string | undefined {
    return this.secrets.get(name)?.value;
  }

  reset(): void {
    this.projects.forEach((project) => {
      if (project.completionTimer) {
        clearTimeout(project.completionTimer);
      }
    });

    this.projects.clear();
    this.customers.clear();
    this.secrets.clear();
    this.webhookCallbacks.clear();
    this.projectIdCounter = 10000;
    this.customerIdCounter = 1;
  }
}

export const mockStakworkState = new MockStakworkStateManager();
