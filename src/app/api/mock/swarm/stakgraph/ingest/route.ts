import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// In-memory storage for mock ingestion status
interface IngestStatus {
  request_id: string;
  workspace_id: string;
  status: "In Progress" | "Complete" | "Failed";
  started_at: string;
  completed_at?: string;
  progress_percentage: number;
  current_message: string;
}

class MockIngestStatusManager {
  private statusStore = new Map<string, IngestStatus>();
  private progressIntervals = new Map<string, NodeJS.Timeout>();

  private readonly progressMessages = [
    "Analyzing repository structure...",
    "Processing TypeScript files...",
    "Extracting function signatures...",
    "Building dependency graph...",
    "Analyzing code patterns...",
    "Generating insights...",
    "Finalizing analysis..."
  ];

  createIngest(requestId: string, workspaceId: string): IngestStatus {
    const initialStatus: IngestStatus = {
      request_id: requestId,
      workspace_id: workspaceId,
      status: "In Progress",
      started_at: new Date().toISOString(),
      progress_percentage: 0,
      current_message: "Initializing code analysis...",
    };

    this.statusStore.set(requestId, initialStatus);
    this.startProgressSimulation(requestId);
    return initialStatus;
  }

  getStatus(requestId: string): IngestStatus | null {
    return this.statusStore.get(requestId) || null;
  }

  updateStatus(requestId: string, updates: Partial<IngestStatus>): IngestStatus | null {
    const currentStatus = this.statusStore.get(requestId);
    if (!currentStatus) return null;

    const updatedStatus = { ...currentStatus, ...updates };
    this.statusStore.set(requestId, updatedStatus);
    return updatedStatus;
  }

  completeIngest(requestId: string): IngestStatus | null {
    const status = this.updateStatus(requestId, {
      status: "Complete",
      progress_percentage: 100,
      current_message: "Code analysis completed successfully",
      completed_at: new Date().toISOString(),
    });

    this.stopProgressSimulation(requestId);
    return status;
  }

  failIngest(requestId: string, errorMessage: string): IngestStatus | null {
    const status = this.updateStatus(requestId, {
      status: "Failed",
      current_message: errorMessage,
      completed_at: new Date().toISOString(),
    });

    this.stopProgressSimulation(requestId);
    return status;
  }

  private startProgressSimulation(requestId: string): void {
    let currentStep = 0;

    const progressInterval = setInterval(() => {
      const currentStatus = this.statusStore.get(requestId);
      if (!currentStatus || currentStatus.status !== "In Progress") {
        this.stopProgressSimulation(requestId);
        return;
      }

      currentStep++;
      const progress = Math.min(Math.round((currentStep / this.progressMessages.length) * 100), 100);

      if (currentStep >= this.progressMessages.length) {
        this.completeIngest(requestId);
      } else {
        this.updateStatus(requestId, {
          progress_percentage: progress,
          current_message: this.progressMessages[currentStep - 1],
        });
      }
    }, 3000); // Update every 3 seconds

    this.progressIntervals.set(requestId, progressInterval);
  }

  private stopProgressSimulation(requestId: string): void {
    const interval = this.progressIntervals.get(requestId);
    if (interval) {
      clearInterval(interval);
      this.progressIntervals.delete(requestId);
    }
  }

  deleteIngest(requestId: string): boolean {
    this.stopProgressSimulation(requestId);
    return this.statusStore.delete(requestId);
  }

  getAllIngests(): IngestStatus[] {
    return Array.from(this.statusStore.values());
  }

  getIngestsByWorkspace(workspaceId: string): IngestStatus[] {
    return Array.from(this.statusStore.values()).filter(
      status => status.workspace_id === workspaceId
    );
  }
}

// Singleton instance for the mock manager
const mockIngestManager = new MockIngestStatusManager();

/**
 * Mock endpoint for Stakgraph code ingestion
 * POST /api/swarm/stakgraph/ingest - Start code analysis ingestion
 * Note: No authentication required for mock endpoints
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workspaceId } = body;

    console.log("[Mock Stakgraph] Starting ingestion for workspace:", workspaceId);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 800 + 400));

    const requestId = `[MOCK]ingest-${Math.floor(Math.random() * 10000) + 1000}`;

    // Create ingestion using the manager
    const initialStatus = mockIngestManager.createIngest(requestId, workspaceId);

    const mockResponse = {
      success: true,
      data: {
        request_id: requestId,
        workspace_id: workspaceId,
        status: "started",
        estimated_duration: "5-15 minutes",
        started_at: initialStatus.started_at,
      },
      message: "Code ingestion started successfully"
    };

    console.log("[Mock Stakgraph] Ingestion started:", requestId);
    return NextResponse.json(mockResponse);
  } catch (error) {
    console.error("Error in mock Stakgraph ingest:", error);
    return NextResponse.json({
      success: false,
      error: "Failed to start ingestion"
    }, { status: 500 });
  }
}

/**
 * GET /api/swarm/stakgraph/ingest - Check ingestion status
 * Query params: id (request_id), workspaceId
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const requestId = searchParams.get("id");
    const workspaceId = searchParams.get("workspaceId");

    if (!requestId || !workspaceId) {
      return NextResponse.json({
        apiResult: {
          ok: false,
          error: "Missing required parameters: id, workspaceId"
        }
      }, { status: 400 });
    }

    console.log("[Mock Stakgraph] Checking status for:", requestId);

    const status = mockIngestManager.getStatus(requestId);

    if (!status) {
      return NextResponse.json({
        apiResult: {
          ok: false,
          error: "Ingestion request not found"
        }
      }, { status: 404 });
    }

    // Simulate occasional API delays
    await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 50));

    const response = {
      apiResult: {
        ok: true,
        data: {
          status: status.status,
          progress_percentage: status.progress_percentage,
          update: {
            message: status.current_message
          },
          started_at: status.started_at,
          completed_at: status.completed_at,
        }
      }
    };

    console.log(`[Mock Stakgraph] Status: ${status.status} (${status.progress_percentage}%) - ${status.current_message}`);
    return NextResponse.json(response);
  } catch (error) {
    console.error("Error checking mock Stakgraph status:", error);
    return NextResponse.json({
      apiResult: {
        ok: false,
        error: "Failed to check ingestion status"
      }
    }, { status: 500 });
  }
}