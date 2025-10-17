import { createConsumer } from '@anycable/web'

// 1. Configure your websocket address
// let WEBSOCKET_HOST = 'ws://lvh.me/cable';
// if (process.env.NODE_ENV === 'production') {
//   WEBSOCKET_HOST = 'wss://stakwork.com/cable';
// } else if (process.env.NODE_ENV === 'staging') {
//   WEBSOCKET_HOST = 'wss://staging.stakwork.com/cable';
// }

export default function WorkflowEdit(railsEnv, workflowId, onUpdate) {
  // 2. Define our constructor
  this.cable = createConsumer()
  this.channel;
  this.workflowId = workflowId;
  this.onUpdate = onUpdate;

  // 3. Define the function we will call to subscribe to our channel
  this.subscribe = () => {
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

  // 4. Define our default ActionCable callbacks.
  this.received = (data) => {
    console.log(`Received Data: ${data}`);

    this.onUpdate(data);
  };

  this.connected = () => {
    console.log(`Workflow ${this.workflowId} connected`);
  };

  this.disconnected = () => {
    console.warn(`Workflow ${this.workflowId} was disconnected.`);
  };

  this.rejected = () => {
    console.warn('I was rejected! :(');
  };
}