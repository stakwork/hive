// Mock Services Status Manager for unified status tracking
interface ServicesStatus {
  request_id: string;
  workspace_id: string;
  swarm_id: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  started_at: string;
  completed_at?: string;
  processing_step: number;
  total_steps: number;
  current_task: string;
  progress_percentage: number;
  services?: Array<{
    name: string;
    status: string;
    port: number;
    health_check: string;
  }>;
  environment_variables?: Record<string, string>;
}

export class MockServicesStatusManager {
  private statusStore = new Map<string, ServicesStatus>();
  private progressIntervals = new Map<string, NodeJS.Timeout>();

  private readonly processingSteps = [
    "Initializing agent environment",
    "Analyzing repository structure",
    "Processing code dependencies",
    "Setting up services configuration",
    "Finalizing environment setup"
  ];

  createServicesRequest(requestId: string, workspaceId: string, swarmId: string): ServicesStatus {
    const initialStatus: ServicesStatus = {
      request_id: requestId,
      workspace_id: workspaceId,
      swarm_id: swarmId,
      status: "PENDING",
      started_at: new Date().toISOString(),
      processing_step: 0,
      total_steps: this.processingSteps.length,
      current_task: "Initializing services setup...",
      progress_percentage: 0,
    };

    this.statusStore.set(requestId, initialStatus);
    return initialStatus;
  }

  startProcessing(requestId: string): ServicesStatus | null {
    const status = this.statusStore.get(requestId);
    if (!status || status.status !== "PENDING") return null;

    const updatedStatus = {
      ...status,
      status: "PROCESSING" as const,
      current_task: this.processingSteps[0],
    };

    this.statusStore.set(requestId, updatedStatus);
    this.startProgressSimulation(requestId);
    return updatedStatus;
  }

  getStatus(requestId: string): ServicesStatus | null {
    return this.statusStore.get(requestId) || null;
  }

  updateStatus(requestId: string, updates: Partial<ServicesStatus>): ServicesStatus | null {
    const currentStatus = this.statusStore.get(requestId);
    if (!currentStatus) return null;

    const updatedStatus = { ...currentStatus, ...updates };
    this.statusStore.set(requestId, updatedStatus);
    return updatedStatus;
  }

  completeServices(requestId: string): ServicesStatus | null {
    const mockServices = [
      {
        name: "mock-stakgraph-service",
        status: "active",
        port: 3355,
        health_check: "/health"
      },
      {
        name: "mock-jarvis-service",
        status: "active",
        port: 8444,
        health_check: "/api/health"
      },
      {
        name: "mock-code-analysis-service",
        status: "active",
        port: 9000,
        health_check: "/status"
      }
    ];

    const status = this.updateStatus(requestId, {
      status: "COMPLETED",
      processing_step: this.processingSteps.length,
      progress_percentage: 100,
      current_task: "Services setup completed successfully",
      completed_at: new Date().toISOString(),
      services: mockServices,
      environment_variables: {
        SERVICES_READY: "true",
        MOCK_MODE: "true"
      }
    });

    this.stopProgressSimulation(requestId);
    return status;
  }

  failServices(requestId: string, errorMessage: string): ServicesStatus | null {
    const status = this.updateStatus(requestId, {
      status: "FAILED",
      current_task: errorMessage,
      completed_at: new Date().toISOString(),
    });

    this.stopProgressSimulation(requestId);
    return status;
  }

  private startProgressSimulation(requestId: string): void {
    let currentStep = 0;

    const progressInterval = setInterval(() => {
      const currentStatus = this.statusStore.get(requestId);
      if (!currentStatus || currentStatus.status !== "PROCESSING") {
        this.stopProgressSimulation(requestId);
        return;
      }

      currentStep++;
      const progress = Math.min(Math.round((currentStep / this.processingSteps.length) * 100), 100);

      if (currentStep >= this.processingSteps.length) {
        this.completeServices(requestId);
      } else {
        this.updateStatus(requestId, {
          processing_step: currentStep,
          progress_percentage: progress,
          current_task: this.processingSteps[currentStep - 1],
        });
      }
    }, 2000); // Update every 2 seconds

    this.progressIntervals.set(requestId, progressInterval);
  }

  private stopProgressSimulation(requestId: string): void {
    const interval = this.progressIntervals.get(requestId);
    if (interval) {
      clearInterval(interval);
      this.progressIntervals.delete(requestId);
    }
  }

  deleteServices(requestId: string): boolean {
    this.stopProgressSimulation(requestId);
    return this.statusStore.delete(requestId);
  }

  getAllServices(): ServicesStatus[] {
    return Array.from(this.statusStore.values());
  }

  getServicesByWorkspace(workspaceId: string): ServicesStatus[] {
    return Array.from(this.statusStore.values()).filter(
      status => status.workspace_id === workspaceId
    );
  }

  getServicesBySwarm(swarmId: string): ServicesStatus[] {
    return Array.from(this.statusStore.values()).filter(
      status => status.swarm_id === swarmId
    );
  }
}

// Singleton instance for the mock manager
export const mockServicesManager = new MockServicesStatusManager();