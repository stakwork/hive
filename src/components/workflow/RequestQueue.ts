// RequestQueue - A class to handle sequential workflow updates
import { AxiosResponse } from "axios";

interface RequestMetadata {
  type: string;
  nodeIds?: string[];
  connectionIds?: string[];
}

interface PendingChange {
  type: string;
  timestamp: number;
  version: string | null;
}

interface QueuedRequest {
  requestFn: (version?: string | null) => Promise<AxiosResponse<any>>;
  metadata: RequestMetadata;
  version: string | null;
  resolve: (value: AxiosResponse<any>) => void;
  reject: (reason?: any) => void;
}

class RequestQueue {
  private queue: QueuedRequest[] = [];
  private isProcessing: boolean = false;
  public latestVersion: string | null = null;
  private pendingChanges: Map<string, PendingChange> = new Map();

  /**
   * Add a request to the queue with its associated changes and metadata
   */
  enqueue(
    requestFn: (version?: string | null) => Promise<AxiosResponse<any>>,
    metadata: RequestMetadata,
    currentVersion?: string,
  ): Promise<AxiosResponse<any>> {
    return new Promise((resolve, reject) => {
      // Track these changes in our pending changes map
      if (metadata.nodeIds) {
        metadata.nodeIds.forEach((nodeId) => {
          this.pendingChanges.set(nodeId, {
            type: metadata.type,
            timestamp: Date.now(),
            version: this.latestVersion || currentVersion || null,
          });
        });
      }

      this.queue.push({
        requestFn,
        metadata,
        version: this.latestVersion || currentVersion || null,
        resolve,
        reject,
      });

      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process the next request in the queue
   */
  private async processQueue(): Promise<void> {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const nextRequest = this.queue[0];

    try {
      // Add the latest known version to the request
      const response = await nextRequest.requestFn(this.latestVersion || nextRequest.version);

      // Update our tracked version
      if (response.data && response.data.data && response.data.data.workflow_version_id) {
        this.latestVersion = response.data.data.workflow_version_id;
      }

      // Clean up the pending changes map for processed nodeIds
      if (nextRequest.metadata.nodeIds) {
        nextRequest.metadata.nodeIds.forEach((nodeId) => {
          this.pendingChanges.delete(nodeId);
        });
      }

      nextRequest.resolve(response);
    } catch (error) {
      console.error("Error processing request:", error);
      nextRequest.reject(error);
    } finally {
      // Remove the processed request
      this.queue.shift();

      // Continue processing the queue
      this.processQueue();
    }
  }

  /**
   * Check if there are pending changes for a specific node
   */
  hasPendingChanges(nodeId: string): boolean {
    return this.pendingChanges.has(nodeId);
  }

  /**
   * Get current queue length
   */
  get length(): number {
    return this.queue.length;
  }

  /**
   * Clear the queue (useful when switching workflows or components)
   */
  clear(): void {
    // Reject all pending requests
    this.queue.forEach((request) => {
      request.reject(new Error("Queue cleared"));
    });

    this.queue = [];
    this.pendingChanges.clear();
    this.isProcessing = false;
  }
}

export default RequestQueue;
