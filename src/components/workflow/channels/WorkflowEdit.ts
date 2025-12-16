import { createConsumer } from '@anycable/web';
import type { WorkflowEditData } from '@/types/stakwork/websocket';

class WorkflowEdit {
  private cable: ReturnType<typeof createConsumer>;
  private workflowId: string;
  private onUpdate: (data: WorkflowEditData) => void;

  constructor(_railsEnv: string, workflowId: string, onUpdate: (data: WorkflowEditData) => void) {
    this.cable = createConsumer();
    this.workflowId = workflowId;
    this.onUpdate = onUpdate;
  }

  subscribe = (): void => {
    this.cable.subscriptions.create(
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
}

export default WorkflowEdit;
