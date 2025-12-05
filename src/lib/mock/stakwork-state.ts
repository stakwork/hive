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

interface MockGenerateRequest {
  id: string;
  prompt: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  result?: {
    files: Array<{
      path: string;
      content: string;
      language: string;
    }>;
    summary: string;
    estimatedEffort: string;
  };
  created_at: string;
  completed_at?: string;
}

interface MockPlanRequest {
  id: string;
  description: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  result?: {
    tasks: Array<{
      id: string;
      title: string;
      description: string;
      priority: "high" | "medium" | "low";
      estimatedHours: number;
      dependencies: string[];
    }>;
    phases: Array<{
      name: string;
      taskIds: string[];
      duration: string;
    }>;
    summary: string;
    totalEstimatedHours: number;
  };
  created_at: string;
  completed_at?: string;
}

interface MockResearchData {
  id: string;
  topic: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  result?: {
    insights: Array<{
      title: string;
      description: string;
      confidence: number;
      sources: string[];
    }>;
    recommendations: Array<{
      title: string;
      description: string;
      priority: "high" | "medium" | "low";
      effort: "low" | "medium" | "high";
    }>;
    summary: string;
    keyFindings: string[];
  };
  created_at: string;
  completed_at?: string;
}

class MockStakworkStateManager {
  private projects: Map<number, MockStakworkProject> = new Map();
  private customers: Map<string, MockStakworkCustomer> = new Map();
  private secrets: Map<string, MockStakworkSecret> = new Map();
  private projectIdCounter = 10000;
  private customerIdCounter = 1;
  private webhookCallbacks: Map<number, string> = new Map();
  private generateRequests: Map<string, MockGenerateRequest> = new Map();
  private planRequests: Map<string, MockPlanRequest> = new Map();
  private researchData: Map<string, MockResearchData> = new Map();
  private requestIdCounter = 1000;

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
    this.generateRequests.clear();
    this.planRequests.clear();
    this.researchData.clear();
    this.requestIdCounter = 1000;
  }

  // Generate operations
  createGenerateRequest(
    prompt: string,
    webhookUrl?: string
  ): MockGenerateRequest {
    const id = `gen_${this.requestIdCounter++}`;
    const request: MockGenerateRequest = {
      id,
      prompt,
      status: "pending",
      progress: 0,
      created_at: new Date().toISOString(),
    };

    this.generateRequests.set(id, request);

    // Start async simulation
    this.simulateGeneration(id, webhookUrl);

    return request;
  }

  getGenerateRequest(id: string): MockGenerateRequest | undefined {
    return this.generateRequests.get(id);
  }

  private async simulateGeneration(
    id: string,
    webhookUrl?: string
  ): Promise<void> {
    const request = this.generateRequests.get(id);
    if (!request) return;

    // Simulate processing stages
    const stages = [
      { status: "processing" as const, progress: 20, delay: 1000 },
      { status: "processing" as const, progress: 50, delay: 2000 },
      { status: "processing" as const, progress: 80, delay: 1500 },
    ];

    for (const { status, progress, delay } of stages) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      request.status = status;
      request.progress = progress;
    }

    // Complete with results
    await new Promise((resolve) => setTimeout(resolve, 1000));
    request.status = "completed";
    request.progress = 100;
    request.completed_at = new Date().toISOString();
    request.result = {
      files: [
        {
          path: "src/components/NewFeature/index.tsx",
          content: `import React from 'react';

export const NewFeature: React.FC = () => {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">New Feature</h1>
      <p>Generated component based on your requirements.</p>
    </div>
  );
};`,
          language: "typescript",
        },
        {
          path: "src/components/NewFeature/NewFeature.test.tsx",
          content: `import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NewFeature } from './index';

describe('NewFeature', () => {
  it('renders correctly', () => {
    render(<NewFeature />);
    expect(screen.getByText('New Feature')).toBeInTheDocument();
  });
});`,
          language: "typescript",
        },
        {
          path: "src/components/NewFeature/styles.module.css",
          content: `.container {
  padding: 1rem;
  background-color: #f5f5f5;
}

.title {
  font-size: 1.5rem;
  font-weight: bold;
}`,
          language: "css",
        },
      ],
      summary:
        "Generated a new React component with TypeScript, tests, and styles based on your requirements. The component follows best practices and includes proper typing.",
      estimatedEffort: "2-4 hours for integration and refinement",
    };

    // Trigger webhook if provided
    if (webhookUrl) {
      this.triggerWebhookGeneric(webhookUrl, {
        type: "generate.completed",
        requestId: id,
        status: request.status,
        result: request.result,
      });
    }
  }

  // Plan operations
  createPlanRequest(
    description: string,
    webhookUrl?: string
  ): MockPlanRequest {
    const id = `plan_${this.requestIdCounter++}`;
    const request: MockPlanRequest = {
      id,
      description,
      status: "pending",
      progress: 0,
      created_at: new Date().toISOString(),
    };

    this.planRequests.set(id, request);

    // Start async simulation
    this.simulatePlanning(id, webhookUrl);

    return request;
  }

  getPlanRequest(id: string): MockPlanRequest | undefined {
    return this.planRequests.get(id);
  }

  private async simulatePlanning(
    id: string,
    webhookUrl?: string
  ): Promise<void> {
    const request = this.planRequests.get(id);
    if (!request) return;

    // Simulate processing stages
    const stages = [
      { status: "processing" as const, progress: 25, delay: 1500 },
      { status: "processing" as const, progress: 60, delay: 2000 },
      { status: "processing" as const, progress: 85, delay: 1500 },
    ];

    for (const { status, progress, delay } of stages) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      request.status = status;
      request.progress = progress;
    }

    // Complete with results
    await new Promise((resolve) => setTimeout(resolve, 1000));
    request.status = "completed";
    request.progress = 100;
    request.completed_at = new Date().toISOString();
    request.result = {
      tasks: [
        {
          id: "task_001",
          title: "Setup project infrastructure",
          description:
            "Initialize repository, configure build tools, and set up CI/CD pipeline",
          priority: "high",
          estimatedHours: 8,
          dependencies: [],
        },
        {
          id: "task_002",
          title: "Design database schema",
          description:
            "Create entity-relationship diagrams and design database tables",
          priority: "high",
          estimatedHours: 6,
          dependencies: ["task_001"],
        },
        {
          id: "task_003",
          title: "Implement authentication system",
          description:
            "Build user authentication with OAuth and session management",
          priority: "high",
          estimatedHours: 12,
          dependencies: ["task_002"],
        },
        {
          id: "task_004",
          title: "Create API endpoints",
          description: "Develop RESTful API endpoints for core functionality",
          priority: "medium",
          estimatedHours: 16,
          dependencies: ["task_003"],
        },
        {
          id: "task_005",
          title: "Build frontend components",
          description: "Develop React components and pages for the UI",
          priority: "medium",
          estimatedHours: 20,
          dependencies: ["task_004"],
        },
        {
          id: "task_006",
          title: "Write tests",
          description: "Create unit, integration, and E2E tests",
          priority: "medium",
          estimatedHours: 16,
          dependencies: ["task_005"],
        },
        {
          id: "task_007",
          title: "Performance optimization",
          description: "Optimize queries, add caching, and improve load times",
          priority: "low",
          estimatedHours: 8,
          dependencies: ["task_006"],
        },
        {
          id: "task_008",
          title: "Documentation",
          description: "Write API docs, user guides, and developer documentation",
          priority: "low",
          estimatedHours: 6,
          dependencies: ["task_007"],
        },
      ],
      phases: [
        {
          name: "Foundation",
          taskIds: ["task_001", "task_002"],
          duration: "1-2 weeks",
        },
        {
          name: "Core Development",
          taskIds: ["task_003", "task_004", "task_005"],
          duration: "3-4 weeks",
        },
        {
          name: "Quality & Polish",
          taskIds: ["task_006", "task_007", "task_008"],
          duration: "2-3 weeks",
        },
      ],
      summary:
        "Comprehensive development plan with 8 tasks across 3 phases, covering infrastructure, core features, and quality assurance.",
      totalEstimatedHours: 92,
    };

    // Trigger webhook if provided
    if (webhookUrl) {
      this.triggerWebhookGeneric(webhookUrl, {
        type: "plan.completed",
        requestId: id,
        status: request.status,
        result: request.result,
      });
    }
  }

  // Research operations
  createResearchRequest(
    topic: string,
    webhookUrl?: string
  ): MockResearchData {
    const id = `research_${this.requestIdCounter++}`;
    const request: MockResearchData = {
      id,
      topic,
      status: "pending",
      progress: 0,
      created_at: new Date().toISOString(),
    };

    this.researchData.set(id, request);

    // Start async simulation
    this.simulateResearch(id, webhookUrl);

    return request;
  }

  getResearchData(id: string): MockResearchData | undefined {
    return this.researchData.get(id);
  }

  private async simulateResearch(
    id: string,
    webhookUrl?: string
  ): Promise<void> {
    const request = this.researchData.get(id);
    if (!request) return;

    // Simulate deep research stages
    const stages = [
      { status: "processing" as const, progress: 15, delay: 2000 },
      { status: "processing" as const, progress: 35, delay: 2500 },
      { status: "processing" as const, progress: 55, delay: 2000 },
      { status: "processing" as const, progress: 75, delay: 2500 },
      { status: "processing" as const, progress: 90, delay: 2000 },
    ];

    for (const { status, progress, delay } of stages) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      request.status = status;
      request.progress = progress;
    }

    // Complete with results
    await new Promise((resolve) => setTimeout(resolve, 1500));
    request.status = "completed";
    request.progress = 100;
    request.completed_at = new Date().toISOString();
    request.result = {
      insights: [
        {
          title: "Code Architecture Patterns",
          description:
            "The codebase follows a modular architecture with clear separation of concerns. Components are well-organized into feature directories.",
          confidence: 0.92,
          sources: [
            "src/components/*",
            "src/lib/*",
            "Architecture documentation",
          ],
        },
        {
          title: "Testing Coverage Gaps",
          description:
            "Current test coverage is at 68%. Key areas missing tests include error handling in API routes and edge cases in form validation.",
          confidence: 0.88,
          sources: ["Coverage reports", "Test files analysis", "CI/CD logs"],
        },
        {
          title: "Performance Bottlenecks",
          description:
            "Database queries in the user dashboard are not optimized. Multiple sequential queries could be combined into a single query with joins.",
          confidence: 0.85,
          sources: [
            "Performance profiling",
            "Database query logs",
            "APM metrics",
          ],
        },
        {
          title: "Security Considerations",
          description:
            "Authentication flow is robust, but rate limiting is not implemented on public API endpoints, making them vulnerable to abuse.",
          confidence: 0.79,
          sources: [
            "Security audit report",
            "API endpoint analysis",
            "OWASP guidelines",
          ],
        },
        {
          title: "Documentation Quality",
          description:
            "Code is well-documented with JSDoc comments. However, API documentation is outdated and doesn't reflect recent endpoint changes.",
          confidence: 0.91,
          sources: [
            "Code comments",
            "API documentation",
            "README files",
          ],
        },
      ],
      recommendations: [
        {
          title: "Implement Database Query Optimization",
          description:
            "Refactor dashboard queries to use JOIN operations and implement query result caching to reduce database load by ~40%.",
          priority: "high",
          effort: "medium",
        },
        {
          title: "Add Rate Limiting Middleware",
          description:
            "Implement rate limiting on all public API endpoints using a middleware solution like express-rate-limit or similar.",
          priority: "high",
          effort: "low",
        },
        {
          title: "Increase Test Coverage",
          description:
            "Focus on adding tests for error handling scenarios and edge cases. Target 80%+ coverage for critical paths.",
          priority: "medium",
          effort: "high",
        },
        {
          title: "Update API Documentation",
          description:
            "Synchronize API documentation with current endpoint implementations. Consider using OpenAPI/Swagger for automatic documentation generation.",
          priority: "medium",
          effort: "low",
        },
        {
          title: "Performance Monitoring Setup",
          description:
            "Implement application performance monitoring (APM) to track response times, error rates, and resource usage in production.",
          priority: "low",
          effort: "medium",
        },
      ],
      summary:
        "Deep research analysis reveals a well-structured codebase with good documentation practices. Primary areas for improvement are database query optimization, API rate limiting, and test coverage expansion.",
      keyFindings: [
        "Modular architecture with clear separation of concerns",
        "68% test coverage with gaps in error handling",
        "Database query optimization needed for dashboard",
        "Rate limiting missing on public API endpoints",
        "API documentation needs updating",
      ],
    };

    // Trigger webhook if provided
    if (webhookUrl) {
      this.triggerWebhookGeneric(webhookUrl, {
        type: "research.completed",
        requestId: id,
        status: request.status,
        result: request.result,
      });
    }
  }

  private async triggerWebhookGeneric(url: string, payload: unknown): Promise<void> {
    try {
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      console.log(`[Mock Stakwork] Webhook triggered: ${url}`);
    } catch (error) {
      console.error(`[Mock Stakwork] Webhook failed: ${url}`, error);
    }
  }
}

export const mockStakworkState = new MockStakworkStateManager();
