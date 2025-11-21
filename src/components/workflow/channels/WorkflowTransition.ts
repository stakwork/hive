import { createConsumer } from "@anycable/web";
import type { WorkflowTransitionData } from "@/types/stakwork/websocket";

class WorkflowTransition {
  // Configuration
  private readonly DEBOUNCE_TIME = 1000; // 1 second debounce window
  private readonly MAX_WAIT_TIME = 2000; // Don't wait more than 2 seconds between updates

  private cable: ReturnType<typeof createConsumer>;
  private channel: any | null = null;
  private projectId: string;
  private onUpdate: (data: WorkflowTransitionData) => void;
  private lastProcessedTime: number = 0;
  private lastReceivedTime: number = 0;
  private pendingUpdate: WorkflowTransitionData | null = null;
  private updateTimeout: NodeJS.Timeout | null = null;
  private updateQueue: any[] = [];

  constructor(railsEnv: string, projectId: string, onUpdate: (data: WorkflowTransitionData) => void) {
    this.cable = createConsumer();
    this.projectId = projectId;
    this.onUpdate = onUpdate;
  }

  subscribe = (): WorkflowTransition => {
    this.channel = this.cable.subscriptions.create(
      { channel: "WorkflowChannel", id: this.projectId },
      {
        connected: this.connected,
        disconnected: this.disconnected,
        received: this.received,
        rejected: this.rejected,
      },
    );
    return this;
  };

  private processImmediately = (): void => {
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

  private scheduleProcessing = (delayMs: number): void => {
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

  private received = (data: WorkflowTransitionData): void => {
    const now = new Date().getTime();

    // Always update our tracking of when we last received an update
    this.lastReceivedTime = now;

    // Always store the latest update
    this.pendingUpdate = data;

    // Calculate time since last processed update
    const timeSinceLastProcessed = now - this.lastProcessedTime;

    // Case 1: If it's been a long time since our last update, process immediately
    if (timeSinceLastProcessed > this.MAX_WAIT_TIME) {
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
    console.log(`Scheduling update to process in ${this.DEBOUNCE_TIME}ms`);
    this.scheduleProcessing(this.DEBOUNCE_TIME);
  };

  private connected = (): void => {
    console.log(`Run ${this.projectId} connected`);
  };

  private disconnected = (): void => {
    console.warn(`Run ${this.projectId} was disconnected.`);
  };

  private rejected = (): void => {
    console.warn(`Connection to Run ${this.projectId} was rejected.`);
  };

  forceUpdate = (): WorkflowTransition => {
    if (this.pendingUpdate) {
      this.processImmediately();
    }
    return this;
  };

  unsubscribe = (): WorkflowTransition => {
    if (this.channel) {
      this.channel.disconnect();
      this.channel = null;
    }

    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
      this.updateTimeout = null;
    }

    return this;
  };
}

export default WorkflowTransition;
