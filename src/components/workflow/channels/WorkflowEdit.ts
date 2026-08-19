import { createConsumer } from '@anycable/web';
import type { WorkflowEditData } from '@/types/stakwork/websocket';
import { cableUrl, type CableSubscription } from '@/lib/anycable';

class WorkflowEdit {
  private cable: ReturnType<typeof createConsumer>;
  private channel: CableSubscription | null = null;
  private workflowId: string;
  private onUpdate: (data: WorkflowEditData) => void;

  constructor(railsEnv: string, workflowId: string, onUpdate: (data: WorkflowEditData) => void) {
    this.cable = createConsumer(cableUrl(railsEnv));
    this.workflowId = workflowId;
    this.onUpdate = onUpdate;
  }

  subscribe = (): void => {
    this.channel = this.cable.subscriptions.create(
      { channel: 'WorkflowEditChannel', id: this.workflowId },
      {
        connected: this.connected,
        disconnected: this.disconnected,
        received: this.received,
        rejected: this.rejected,
      }
    );
  };

  private received = (data: WorkflowEditData): void => {
    console.log(`Received Data:`, data);
    this.onUpdate(data);
  };

  private connected = (): void => {
    console.log(`Workflow ${this.workflowId} connected`);
  };

  private disconnected = (): void => {
    console.warn(`Workflow ${this.workflowId} was disconnected.`);
  };

  private rejected = (): void => {
    console.warn('I was rejected! :(');
  };

  unsubscribe = (): void => {
    if (this.channel) {
      this.channel.unsubscribe();
      this.channel = null;
    }
    // The consumer is created per instance, so nothing else is using this
    // socket — leaving it open leaks a connection that keeps reconnecting.
    this.cable.disconnect();
  };
}

export default WorkflowEdit;
