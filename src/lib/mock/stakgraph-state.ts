/**
 * Mock Stakgraph State Manager
 * 
 * Simulates the Stakgraph code ingestion service that runs on swarm instances (port 7799)
 */

export interface MockIngestRequest {
  requestId: string;
  repoUrl: string;
  username: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  progress: number; // 0-100
  callbackUrl?: string;
  createdAt: number;
  completedAt?: number;
  useLsp: boolean;
}

class StakgraphStateManager {
  private static instance: StakgraphStateManager;
  private requests: Map<string, MockIngestRequest> = new Map();
  private requestCounter = 1;

  private constructor() {}

  static getInstance(): StakgraphStateManager {
    if (!StakgraphStateManager.instance) {
      StakgraphStateManager.instance = new StakgraphStateManager();
    }
    return StakgraphStateManager.instance;
  }

  /**
   * Start a new ingestion request
   * Auto-creates the request and simulates async processing
   */
  createIngestRequest(
    repoUrl: string,
    username: string,
    callbackUrl?: string,
    useLsp: boolean = false
  ): string {
    const requestId = `req-${String(this.requestCounter++).padStart(6, '0')}`;
    
    const request: MockIngestRequest = {
      requestId,
      repoUrl,
      username,
      status: 'PENDING',
      progress: 0,
      callbackUrl,
      createdAt: Date.now(),
      useLsp,
    };

    this.requests.set(requestId, request);
    console.log(`[StakgraphMock] Created ingest request ${requestId} for ${repoUrl}`);

    // Simulate async ingestion with status transitions
    this.simulateIngestion(requestId);

    return requestId;
  }

  /**
   * Simulate the ingestion workflow with realistic delays
   */
  private async simulateIngestion(requestId: string): Promise<void> {
    const delays = [
      { status: 'PROCESSING' as const, progress: 10, delay: 1000 },
      { status: 'PROCESSING' as const, progress: 30, delay: 2000 },
      { status: 'PROCESSING' as const, progress: 60, delay: 2000 },
      { status: 'PROCESSING' as const, progress: 90, delay: 1500 },
      { status: 'COMPLETED' as const, progress: 100, delay: 500 },
    ];

    for (const { status, progress, delay } of delays) {
      await new Promise(resolve => setTimeout(resolve, delay));
      
      const request = this.requests.get(requestId);
      if (!request) break;

      request.status = status;
      request.progress = progress;

      if (status === 'COMPLETED') {
        request.completedAt = Date.now();
        console.log(`[StakgraphMock] Ingest request ${requestId} completed`);
        
        // Trigger webhook callback if provided
        if (request.callbackUrl) {
          this.triggerWebhook(requestId, request.callbackUrl);
        }
      }
    }
  }

  /**
   * Trigger webhook callback to notify completion
   */
  private async triggerWebhook(requestId: string, callbackUrl: string): Promise<void> {
    const request = this.requests.get(requestId);
    if (!request) return;

    try {
      console.log(`[StakgraphMock] Triggering webhook for ${requestId} to ${callbackUrl}`);
      
      const payload = {
        request_id: requestId,
        status: request.status.toLowerCase(),
        repo_url: request.repoUrl,
        progress: request.progress,
      };

      // In a real mock, we'd actually call the webhook
      // For now, just log it (the app polls status instead)
      console.log('[StakgraphMock] Webhook payload:', payload);
      
      // Optionally: Actually trigger the webhook
      // await fetch(callbackUrl, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(payload),
      // });
    } catch (error) {
      console.error(`[StakgraphMock] Failed to trigger webhook:`, error);
    }
  }

  /**
   * Get request status (auto-creates if doesn't exist for resilience)
   */
  getRequestStatus(requestId: string): MockIngestRequest | undefined {
    let request = this.requests.get(requestId);
    
    // Auto-create for test resilience
    if (!request) {
      console.log(`[StakgraphMock] Auto-creating request ${requestId}`);
      request = {
        requestId,
        repoUrl: 'https://github.com/mock-org/mock-repo',
        username: 'mock-user',
        status: 'COMPLETED',
        progress: 100,
        createdAt: Date.now() - 5000,
        completedAt: Date.now(),
        useLsp: false,
      };
      this.requests.set(requestId, request);
    }
    
    return request;
  }

  /**
   * Reset all state (for test isolation)
   */
  reset(): void {
    this.requests.clear();
    this.requestCounter = 1;
    console.log('[StakgraphMock] State reset');
  }

  /**
   * Get all requests (for debugging)
   */
  getAllRequests(): MockIngestRequest[] {
    return Array.from(this.requests.values());
  }
}

export const stakgraphState = StakgraphStateManager.getInstance();
