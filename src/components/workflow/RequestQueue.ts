// RequestQueue.js - A class to handle sequential workflow updates

class RequestQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.latestVersion = null;
    this.pendingChanges = new Map(); // Track changes that haven't been processed yet
  }

  /**
   * Add a request to the queue with its associated changes and metadata
   * @param {Function} requestFn - The function that makes the API request, should return a Promise
   * @param {Object} metadata - Information about the request (type, affected nodes, etc.)
   * @param {String} currentVersion - The workflow version this change is based on
   */
  enqueue(requestFn, metadata, currentVersion) {
    return new Promise((resolve, reject) => {
      // Track these changes in our pending changes map
      if (metadata.nodeIds) {
        metadata.nodeIds.forEach(nodeId => {
          this.pendingChanges.set(nodeId, {
            type: metadata.type,
            timestamp: Date.now(),
            version: this.latestVersion || currentVersion
          });
        });
      }

      this.queue.push({
        requestFn,
        metadata,
        version: this.latestVersion || currentVersion,
        resolve,
        reject
      });

      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process the next request in the queue
   */
  async processQueue() {
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
      if (response.data &&
        response.data.data &&
        response.data.data.workflow_version_id) {
        this.latestVersion = response.data.data.workflow_version_id;
      }

      // Clean up the pending changes map for processed nodeIds
      if (nextRequest.metadata.nodeIds) {
        nextRequest.metadata.nodeIds.forEach(nodeId => {
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
   * @param {String} nodeId - The node ID to check
   * @returns {Boolean} - Whether the node has pending changes
   */
  hasPendingChanges(nodeId) {
    return this.pendingChanges.has(nodeId);
  }

  /**
   * Get current queue length
   * @returns {Number} - Number of requests in queue
   */
  get length() {
    return this.queue.length;
  }

  /**
   * Clear the queue (useful when switching workflows or components)
   */
  clear() {
    // Reject all pending requests
    this.queue.forEach(request => {
      request.reject(new Error('Queue cleared'));
    });

    this.queue = [];
    this.pendingChanges.clear();
    this.isProcessing = false;
  }
}

export default RequestQueue;