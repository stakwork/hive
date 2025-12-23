# Pusher Mock Documentation

## Overview

The Pusher mock provides a comprehensive in-memory implementation of the Pusher Real-Time Messaging Service for local development and testing without requiring real Pusher credentials. The mock simulates all Pusher functionality including channel subscriptions, event broadcasting, and real-time message delivery using polling-based updates.

### Capabilities

- **In-memory channels**: Full channel management with subscription tracking
- **Event broadcasting**: Server-side trigger() broadcasts to all channel subscribers
- **Real-time delivery**: Polling-based mechanism with <200ms latency
- **Message history**: Last 100 messages per channel for debugging
- **Connection tracking**: Unique connection IDs for each client
- **Type compatibility**: Fully compatible with real Pusher interfaces

### Supported Events

The mock supports all 10 Pusher events used in the application:

- `NEW_MESSAGE` - New chat message available (sends message ID only)
- `RECOMMENDATIONS_UPDATED` - New test recommendations in insights
- `TASK_TITLE_UPDATE` - Task title changed (task channel)
- `WORKSPACE_TASK_TITLE_UPDATE` - Task title changed (workspace channel)
- `STAKWORK_RUN_UPDATE` - Task status/workflow updates
- `STAKWORK_RUN_DECISION` - Workflow decision events
- `HIGHLIGHT_NODES` - Node highlighting in stakgraph
- `FOLLOW_UP_QUESTIONS` - Workflow follow-up questions
- `CONNECTION_COUNT` - Connection tracking
- `WORKFLOW_STATUS_UPDATE` - Workflow status changes

### Channel Types

- **Task channels**: `task-{taskId}` for task-specific messaging
- **Workspace channels**: `workspace-{workspaceSlug}` for workspace-wide updates

## Enabling Mock Mode

Set the `USE_MOCKS` environment variable to enable Pusher mock mode:

```bash
# .env.local
USE_MOCKS=true
```

When enabled, the application automatically uses mock Pusher implementations without requiring real Pusher credentials.

## Configuration

### Environment Variables

When `USE_MOCKS=true`, the following mock values are automatically provided:

```bash
PUSHER_APP_ID=mock-app-id
PUSHER_KEY=mock-pusher-key
PUSHER_SECRET=mock-pusher-secret
PUSHER_CLUSTER=mock-cluster
```

No additional configuration required - the mock works out of the box.

## Usage

### Server-Side: Triggering Events

```typescript
import { pusherServer, PUSHER_EVENTS, getTaskChannelName } from "@/lib/pusher";

// Trigger event on task channel
await pusherServer.trigger(
  getTaskChannelName(taskId),
  PUSHER_EVENTS.NEW_MESSAGE,
  { messageId: "msg-123" }
);

// Trigger event on workspace channel
await pusherServer.trigger(
  getWorkspaceChannelName(workspaceSlug),
  PUSHER_EVENTS.RECOMMENDATIONS_UPDATED,
  { count: 5 }
);
```

### Client-Side: Subscribing to Channels

```typescript
import { getPusherClient, PUSHER_EVENTS, getTaskChannelName } from "@/lib/pusher";

// Get Pusher client (mock or real based on USE_MOCKS)
const pusher = getPusherClient();

// Subscribe to task channel
const channel = pusher.subscribe(getTaskChannelName(taskId));

// Bind event callback
channel.bind(PUSHER_EVENTS.NEW_MESSAGE, (data: { messageId: string }) => {
  console.log("New message:", data.messageId);
  // Fetch full message data via REST API
});

// Cleanup on unmount
return () => {
  channel.unbind(PUSHER_EVENTS.NEW_MESSAGE);
  pusher.unsubscribe(getTaskChannelName(taskId));
};
```

### Using with React Hooks

The application uses `usePusherConnection` hook for Pusher integration:

```typescript
import { usePusherConnection } from "@/hooks/usePusherConnection";
import { PUSHER_EVENTS } from "@/lib/pusher";

function ChatComponent({ taskId }: { taskId: string }) {
  usePusherConnection({
    channelName: getTaskChannelName(taskId),
    eventName: PUSHER_EVENTS.NEW_MESSAGE,
    onEvent: (data: { messageId: string }) => {
      // Handle new message
      fetchMessage(data.messageId);
    },
    enabled: true,
  });

  return <div>Chat UI</div>;
}
```

## Mock State Manager API

The mock uses a singleton state manager (`pusherMockState`) for managing channels and subscriptions.

### Key Methods

```typescript
import { pusherMockState } from "@/lib/mock/pusher-state";

// Subscribe to channel
pusherMockState.subscribe(connectionId, channelName);

// Bind event callback
pusherMockState.bind(connectionId, channelName, eventName, callback);

// Trigger event (server-side)
pusherMockState.trigger(channelName, eventName, data);

// Get message history
pusherMockState.getChannelMessages(channelName);

// Get subscriber count
pusherMockState.getSubscriberCount(channelName);

// Reset state (testing)
pusherMockState.reset();

// Get state snapshot (debugging)
pusherMockState.getState();
```

### State Structure

```typescript
{
  channels: [
    {
      name: "task-123",
      subscriberCount: 2,
      messageCount: 45,
      events: ["new-message", "task-title-update"]
    }
  ],
  subscriptions: [
    {
      connectionId: "mock-connection-1",
      channelCount: 1,
      channels: ["task-123"]
    }
  ]
}
```

## Testing

### Unit Tests

```typescript
import { pusherMockState } from "@/lib/mock/pusher-state";
import { MockPusherServer, MockPusherClient } from "@/lib/mock/pusher-wrapper";

describe("Pusher Mock", () => {
  beforeEach(() => {
    pusherMockState.reset();
  });

  it("should deliver messages to subscribers", () => {
    const server = new MockPusherServer({
      appId: "test-app",
      key: "test-key",
      secret: "test-secret",
      cluster: "test-cluster",
      useTLS: true,
    });

    const client = new MockPusherClient("test-key", { cluster: "test-cluster" });
    const channel = client.subscribe("test-channel");

    const callback = vi.fn();
    channel.bind("test-event", callback);

    // Trigger event
    server.trigger("test-channel", "test-event", { message: "hello" });

    // Callback should be executed immediately
    expect(callback).toHaveBeenCalledWith({ message: "hello" });
  });
});
```

### Integration Tests

```typescript
import { pusherServer, getPusherClient, PUSHER_EVENTS } from "@/lib/pusher";

describe("Pusher Integration", () => {
  it("should deliver messages end-to-end", async () => {
    const client = getPusherClient();
    const channel = client.subscribe("test-channel");

    const received = vi.fn();
    channel.bind(PUSHER_EVENTS.NEW_MESSAGE, received);

    // Trigger from server
    await pusherServer.trigger("test-channel", PUSHER_EVENTS.NEW_MESSAGE, {
      messageId: "msg-123",
    });

    // Wait for delivery (polling interval + buffer)
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(received).toHaveBeenCalledWith({ messageId: "msg-123" });
  });
});
```

## Message Synchronization Pattern

The application uses an ID-only pattern to work around Pusher's 10KB message size limit:

1. Server saves message to database
2. Server triggers Pusher event with message ID only
3. Clients receive event with ID
4. Clients fetch full message data via REST API
5. Message rendered in UI

### Example

```typescript
// Server-side: Save and broadcast
const message = await db.chatMessage.create({ data: messageData });
await pusherServer.trigger(
  getTaskChannelName(taskId),
  PUSHER_EVENTS.NEW_MESSAGE,
  { messageId: message.id }
);

// Client-side: Receive and fetch
channel.bind(PUSHER_EVENTS.NEW_MESSAGE, async (data: { messageId: string }) => {
  const message = await fetch(`/api/chat/messages/${data.messageId}`).then(r => r.json());
  displayMessage(message);
});
```

## Performance

### Delivery Latency

- **Target**: <200ms from trigger to callback execution
- **Polling interval**: 100ms (configurable)
- **Network simulation**: 50ms average delay on trigger

### Message History

- **Limit**: 100 messages per channel
- **Behavior**: FIFO (oldest messages discarded)
- **Storage**: In-memory (cleared on server restart)

### Memory Usage

- Minimal overhead for typical usage (10-20 channels, 2-5 subscribers each)
- Message history auto-managed with size limits
- Channel cleanup when no subscribers remain

## Troubleshooting

### Events Not Being Received

1. **Check USE_MOCKS flag**: Ensure `USE_MOCKS=true` in environment
2. **Verify subscription**: Check channel name matches trigger channel
3. **Check event name**: Event names are case-sensitive kebab-case strings
4. **Callback binding**: Ensure bind() called before trigger()

### Delayed Message Delivery

- Normal: 100-150ms latency due to polling
- If >200ms: Check for heavy synchronous operations in callbacks
- Polling interval can be reduced for faster delivery (trade-off: CPU usage)

### State Leaks Between Tests

```typescript
import { pusherMockState } from "@/lib/mock/pusher-state";

afterEach(() => {
  pusherMockState.reset(); // Clear all channels and subscriptions
});
```

### Connection Issues

```typescript
// Check connection state
const pusher = getPusherClient();
console.log(pusher.connection.state); // Should be "connected" in mock mode

// Reconnect if needed
pusher.disconnect();
const newPusher = getPusherClient(); // Creates new connection
```

## Implementation Details

### Polling Mechanism

The mock uses interval-based polling to simulate real-time updates:

1. Client binds event callback
2. Mock starts 100ms polling interval
3. Each poll checks for new messages since last poll
4. Callbacks executed immediately on new messages
5. Polling stops when all events unbound

### Message Flow

```
Server: pusherServer.trigger(channel, event, data)
  ↓
Mock State: Store message in channel history
  ↓
Mock State: Execute all callbacks for event
  ↓
Client: Callback receives data immediately
```

### Connection Management

- Each client gets unique connection ID
- Subscriptions tracked per connection
- Cleanup on disconnect removes all subscriptions
- No external broker required

## Related Files

### Implementation
- `src/lib/pusher.ts` - Main Pusher wrapper with conditional mock routing
- `src/lib/mock/pusher-state.ts` - Mock state manager
- `src/lib/mock/pusher-wrapper.ts` - Mock server and client classes

### Configuration
- `src/config/env.ts` - Environment variables and mock credential defaults

### Integration
- `src/hooks/usePusherConnection.ts` - React hook for Pusher subscriptions
- `src/hooks/useTasksHighlight.ts` - Task status update broadcasting
- `src/hooks/useWorkspaceTasks.ts` - Task list real-time updates

### API Endpoints
- `src/app/api/chat/message/route.ts` - Message creation with Pusher trigger
- `src/app/api/chat/response/route.ts` - Chat response with Pusher trigger
- `src/app/api/tasks/[taskId]/title/route.ts` - Task title update broadcast

### Tests
- `src/__tests__/unit/lib/mock/pusher-state.test.ts` - State manager unit tests
- `src/__tests__/integration/pusher-mock.test.ts` - End-to-end integration tests

## Limitations

1. **No presence channels**: Mock does not implement presence channel features
2. **No private channels**: All channels are public in mock mode
3. **No encryption**: Messages not encrypted (use HTTPS in production)
4. **In-memory only**: State lost on server restart
5. **Single process**: Does not work across multiple server instances

## Migration to Real Pusher

To switch from mock to real Pusher:

1. Set `USE_MOCKS=false` in environment
2. Configure real Pusher credentials:
   ```bash
   PUSHER_APP_ID=your-app-id
   PUSHER_KEY=your-pusher-key
   PUSHER_SECRET=your-secret
   PUSHER_CLUSTER=your-cluster
   NEXT_PUBLIC_PUSHER_KEY=your-pusher-key
   NEXT_PUBLIC_PUSHER_CLUSTER=your-cluster
   ```
3. No code changes required - mock and real Pusher are API-compatible

## Support

For issues or questions about the Pusher mock:

1. Check this documentation
2. Review existing tests for usage examples
3. Inspect mock state with `pusherMockState.getState()`
4. Enable verbose logging for debugging