import { createConsumer } from '@anycable/web'

export default function WorkflowTransition(railsEnv, projectId, onUpdate) {
  // Configuration
  const DEBOUNCE_TIME = 1000; // 1 second debounce window
  const MAX_WAIT_TIME = 2000; // Don't wait more than 2 seconds between updates

  this.cable = createConsumer();
  this.channel = null;
  this.projectId = projectId;
  this.onUpdate = onUpdate;
  this.lastProcessedTime = 0; // Time when we last processed an update
  this.lastReceivedTime = 0;  // Time when we last received any update
  this.pendingUpdate = null;  // Holds the most recent update waiting to be processed
  this.updateTimeout = null;  // Reference to current timeout (if any)
  this.updateQueue = [];      // Queue of updates to process

  // Subscribe to the channel
  this.subscribe = () => {
    this.channel = this.cable.subscriptions.create(
        { channel: 'WorkflowChannel', id: this.projectId },
        {
          connected: this.connected,
          disconnected: this.disconnected,
          received: this.received,
          rejected: this.rejected,
        }
    );
    return this;
  };

  // Process the pending update immediately
  this.processImmediately = () => {
    if (this.pendingUpdate) {
      console.log(`Processing update immediately: ${this.pendingUpdate.status}`);
      this.onUpdate(this.pendingUpdate);
      this.lastProcessedTime = new Date().getTime();
      this.pendingUpdate = null;
    }

    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
      this.updateTimeout = null;
    }
  };

  // Schedule processing for later
  this.scheduleProcessing = (delayMs) => {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }

    this.updateTimeout = setTimeout(() => {
      if (this.pendingUpdate) {
        console.log(`Processing scheduled update: ${this.pendingUpdate.status}`);
        this.onUpdate(this.pendingUpdate);
        this.lastProcessedTime = new Date().getTime();
        this.pendingUpdate = null;
      }
      this.updateTimeout = null;
    }, delayMs);
  };

  // Handle received messages
  this.received = (data) => {
    const now = new Date().getTime();

    // Always update our tracking of when we last received an update
    this.lastReceivedTime = now;

    // Always store the latest update
    this.pendingUpdate = data;

    // Calculate time since last processed update
    const timeSinceLastProcessed = now - this.lastProcessedTime;

    // Case 1: If it's been a long time since our last update, process immediately
    if (timeSinceLastProcessed > MAX_WAIT_TIME) {
      console.log(`It's been ${timeSinceLastProcessed}ms since last update, processing immediately`);
      this.processImmediately();
      return;
    }

    // Case 2: If we have a pending timeout, let it continue (it will show the latest update)
    if (this.updateTimeout) {
      console.log(`Update received while debouncing, replaced pending update`);
      return;
    }

    // Case 3: Schedule a new timeout to process this update after the debounce period
    console.log(`Scheduling update to process in ${DEBOUNCE_TIME}ms`);
    this.scheduleProcessing(DEBOUNCE_TIME);
  };

  // Connection established
  this.connected = () => {
    console.log(`Run ${this.projectId} connected`);
  };

  // Connection lost
  this.disconnected = () => {
    console.warn(`Run ${this.projectId} was disconnected.`);
  };

  // Connection rejected
  this.rejected = () => {
    console.warn(`Connection to Run ${this.projectId} was rejected.`);
  };

  // Force an immediate update if needed
  this.forceUpdate = () => {
    if (this.pendingUpdate) {
      this.processImmediately();
    }
    return this;
  };

  // Clean up resources
  this.unsubscribe = () => {
    if (this.channel) {
      this.cable.subscriptions.remove(this.channel);
      this.channel = null;
    }

    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
      this.updateTimeout = null;
    }

    return this;
  };
}