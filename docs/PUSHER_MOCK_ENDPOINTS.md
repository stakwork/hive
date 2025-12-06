# Pusher Mock Implementation

## Overview

This document describes the mock implementation for Pusher Real-Time Messaging Service. When `USE_MOCKS=true`, all Pusher operations are handled by an in-memory event bus that simulates WebSocket-based real-time communication without requiring external Pusher credentials.

## Purpose

The Pusher mock enables:

- **Local development** without Pusher account setup
- **Zero configuration** for new developers
- **Deterministic testing** with full control over event delivery
- **Multi-tab synchronization** within the same browser session
- **Cost-free development** with no API limits
- **Offline capability** for development without internet

## Architecture

### Components

1. **PusherMockState** (`src/lib/mock/pusher-state.ts`)
   - Singleton state manager
   - Maintains in-memory channels and subscriptions
   - Handles event broadcasting to all subscribers
   - Provides test isolation via `reset()` method

2. **PusherServerMock** (`src/lib/mock/pusher-server-wrapper.ts`)
   - Server-side Pusher implementation
   - Compatible with `pusher` npm package interface
   - Routes `trigger()` calls to PusherMockState
   - Supports batch event broadcasting

3. **PusherClientMock** (`src/lib/mock/pusher-client-wrapper.ts`)
   - Client-side Pusher implementation
   - Compatible with `pusher-js` npm package interface
   - Provides channel subscription and event binding
   - Simulates connection lifecycle events

### Data Flow

```
Server-side broadcast:
pusherServer.trigger(channel, event, data)
    ↓
PusherServerMock.trigger()
    ↓
PusherMockState.trigger()
    ↓
Notify all subscribed clients synchronously
    ↓
Client callbacks executed

Client-side subscription:
pusher.subscribe(channel)
    ↓
PusherClientMock.subscribe()
    ↓
PusherMockState.subscribe()
    ↓
Return MockChannel instance
    ↓
channel.bind(event, callback)
    ↓
PusherMockState.bind()
    ↓
Register callback for event delivery
```

## Usage

### Configuration

Enable mock mode in your environment:

```bash
# .env.local
USE_MOCKS=true
```

When `USE_MOCKS=true`, Pusher environment variables are **not required**:

```bash
# These are optional in mock mode
# PUSHER_APP_ID=...
# PUSHER_KEY=...
# PUSHER_SECRET=...
# PUSHER_CLUSTER=...
# NEXT_PUBLIC_PUSHER_KEY=...
# NEXT_PUBLIC_PUSHER_CLUSTER=...
```

### Server-side Broadcasting

No code changes required - existing Pusher usage works seamlessly:

```typescript
import { pusherServer, PUSHER_EVENTS } from "@/lib/pusher";

// Single channel
await pusherServer.trigger("task-123", PUSHER_EVENTS.NEW_MESSAGE, {
  messageId: "msg-456",
});

// Multiple channels
await pusherServer.trigger(
  ["task-123", "task-456"],
  PUSHER_EVENTS.TASK_TITLE_UPDATE,
  { taskId: "123", title: "New Title" }
);

// Batch events
await pusherServer.triggerBatch([
  {
    channel: "task-123",
    name: PUSHER_EVENTS.NEW_MESSAGE,
    data: { messageId: "msg-456" },
  },
  {
    channel: "workspace-abc",
    name: PUSHER_EVENTS.RECOMMENDATIONS_UPDATED,
    data: { count: 5 },
  },
]);
```

### Client-side Subscription

Existing client code also works without changes:

```typescript
import { getPusherClient, PUSHER_EVENTS } from "@/lib/pusher";

// Get Pusher client (mock or real based on USE_MOCKS)
const pusher = getPusherClient();

// Subscribe to channel
const channel = pusher.subscribe(`task-${taskId}`);

// Bind event listener
channel.bind(PUSHER_EVENTS.NEW_MESSAGE, (data) => {
  console.log("New message:", data);
});

// Cleanup
channel.unbind(PUSHER_EVENTS.NEW_MESSAGE);
pusher.unsubscribe(`task-${taskId}`);
```

## Features

### Channel Management

Channels are automatically created when subscribed or triggered:

```typescript
// Auto-creates channel if it doesn't exist
const channel = pusher.subscribe("task-123");

// Server-side trigger also auto-creates channel
await pusherServer.trigger("task-123", "event-name", { data: "value" });
```

### Event Synchronization

Events are delivered **synchronously** to simulate WebSocket behavior:

```typescript
// Server broadcasts event
await pusherServer.trigger("task-123", "new-message", { id: "msg-1" });

// All subscribed clients receive event immediately
// (within same Node.js event loop)
```

### Multi-tab Support

Multiple browser tabs sharing the same in-memory state will receive events:

```typescript
// Tab 1: Subscribe to channel
const channel1 = pusher.subscribe("task-123");
channel1.bind("new-message", (data) => {
  console.log("Tab 1 received:", data);
});

// Tab 2: Subscribe to same channel
const channel2 = pusher.subscribe("task-123");
channel2.bind("new-message", (data) => {
  console.log("Tab 2 received:", data);
});

// Server: Broadcast event
await pusherServer.trigger("task-123", "new-message", { id: "msg-1" });

// Both tabs receive the event
```

### Connection Lifecycle

Mock simulates connection events:

```typescript
const pusher = getPusherClient();

// Connection events
pusher.connection.bind("connected", () => {
  console.log("Connected to Pusher");
});

// Subscription success
const channel = pusher.subscribe("task-123");
channel.bind("pusher:subscription_succeeded", () => {
  console.log("Subscribed successfully");
});
```

### Test Isolation

Reset state between tests:

```typescript
import { pusherMockState } from "@/lib/mock/pusher-state";

beforeEach(() => {
  // Clear all channels and subscriptions
  pusherMockState.reset();
});

test("event delivery", async () => {
  // Test with clean state
});
```

## Supported Events

All existing Pusher events are supported:

```typescript
export const PUSHER_EVENTS = {
  NEW_MESSAGE: "new-message",
  CONNECTION_COUNT: "connection-count",
  WORKFLOW_STATUS_UPDATE: "workflow-status-update",
  RECOMMENDATIONS_UPDATED: "recommendations-updated",
  TASK_TITLE_UPDATE: "task-title-update",
  WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
  STAKWORK_RUN_UPDATE: "stakwork-run-update",
  STAKWORK_RUN_DECISION: "stakwork-run-decision",
  STAKWORK_RUN_THINKING_UPDATE: "stakwork-run-thinking-update",
  HIGHLIGHT_NODES: "highlight-nodes",
};
```

## Channel Naming Conventions

The mock respects existing channel naming:

- **Task channels**: `task-{taskId}` (e.g., `task-123`)
- **Workspace channels**: `workspace-{workspaceSlug}` (e.g., `workspace-acme-corp`)

## API Compatibility

### Server-side (pusher)

Mock implements the core `Pusher` class methods:

| Method                     | Description                        | Mock Support |
| -------------------------- | ---------------------------------- | ------------ |
| `trigger(channel, event, data)` | Broadcast event to channel    | ✅ Full       |
| `trigger(channels[], event, data)` | Broadcast to multiple channels | ✅ Full |
| `triggerBatch(events[])`   | Batch event broadcasting           | ✅ Full       |

### Client-side (pusher-js)

Mock implements the core `PusherClient` class:

| Method                   | Description                  | Mock Support |
| ------------------------ | ---------------------------- | ------------ |
| `subscribe(channel)`     | Subscribe to channel         | ✅ Full       |
| `unsubscribe(channel)`   | Unsubscribe from channel     | ✅ Full       |
| `channel(name)`          | Get subscribed channel       | ✅ Full       |
| `allChannels()`          | Get all subscribed channels  | ✅ Full       |
| `bind(event, callback)`  | Global event binding         | ✅ Full       |
| `unbind(event)`          | Unbind global event          | ✅ Full       |
| `disconnect()`           | Disconnect from Pusher       | ✅ Full       |

### Channel Methods

Mock `MockChannel` class:

| Method                        | Description                      | Mock Support |
| ----------------------------- | -------------------------------- | ------------ |
| `bind(event, callback)`       | Bind event listener              | ✅ Full       |
| `unbind(event, callback)`     | Unbind specific listener         | ✅ Full       |
| `unbind(event)`               | Unbind all listeners for event   | ✅ Full       |
| `unbind()`                    | Unbind all listeners             | ✅ Full       |
| `unbind_all()`                | Unbind all listeners (alias)     | ✅ Full       |

## Debugging

### Enable Logging

Mock implementation includes comprehensive logging:

```typescript
// Automatic logging in mock mode
[Pusher Mock] Initializing mock server
[Pusher Mock] Initializing mock client
[Pusher Mock] Creating channel: task-123
[Pusher Mock] Subscribed to channel: task-123 (1 total channels)
[Pusher Mock] Bound event "new-message" on channel "task-123" (1 listeners)
[Pusher Mock] Triggering event "new-message" on channel "task-123"
[Pusher Mock] Notifying 1 listeners for "new-message" on "task-123"
```

### Inspect State

Get debug information about active channels:

```typescript
import { pusherMockState } from "@/lib/mock/pusher-state";

// Get all active channels
const channels = pusherMockState.getActiveChannels();
console.log("Active channels:", channels);

// Get listener count for specific event
const count = pusherMockState.getChannelListenerCount(
  "task-123",
  "new-message"
);
console.log("Listeners for new-message:", count);

// Check connection state
const connected = pusherMockState.isConnected();
console.log("Connected:", connected);

// Get connection ID
const connectionId = pusherMockState.getConnectionId();
console.log("Connection ID:", connectionId);
```

## Testing Examples

### Unit Test Example

```typescript
import { pusherMockState } from "@/lib/mock/pusher-state";
import { getPusherClient, pusherServer } from "@/lib/pusher";

describe("Pusher Mock", () => {
  beforeEach(() => {
    pusherMockState.reset();
  });

  it("should deliver events to subscribers", async () => {
    const pusher = getPusherClient();
    const channel = pusher.subscribe("test-channel");

    const receivedData: any[] = [];
    channel.bind("test-event", (data) => {
      receivedData.push(data);
    });

    await pusherServer.trigger("test-channel", "test-event", {
      message: "Hello",
    });

    expect(receivedData).toHaveLength(1);
    expect(receivedData[0]).toEqual({ message: "Hello" });
  });

  it("should support multiple subscribers", async () => {
    const pusher1 = getPusherClient();
    const pusher2 = getPusherClient();

    const channel1 = pusher1.subscribe("test-channel");
    const channel2 = pusher2.subscribe("test-channel");

    const received1: any[] = [];
    const received2: any[] = [];

    channel1.bind("test-event", (data) => received1.push(data));
    channel2.bind("test-event", (data) => received2.push(data));

    await pusherServer.trigger("test-channel", "test-event", { id: 1 });

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });
});
```

### Integration Test Example

```typescript
import { pusherMockState } from "@/lib/mock/pusher-state";

describe("Chat Message API", () => {
  beforeEach(() => {
    pusherMockState.reset();
  });

  it("should broadcast new message event", async () => {
    const pusher = getPusherClient();
    const channel = pusher.subscribe(`task-${taskId}`);

    const receivedMessages: any[] = [];
    channel.bind(PUSHER_EVENTS.NEW_MESSAGE, (data) => {
      receivedMessages.push(data);
    });

    const response = await fetch("/api/chat/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        content: "Test message",
      }),
    });

    expect(response.status).toBe(200);
    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0]).toHaveProperty("messageId");
  });
});
```

## Limitations

### Not Implemented

The following Pusher features are **not** implemented in the mock:

- **Presence channels**: User presence tracking
- **Private channels**: Channel authentication
- **Encrypted channels**: End-to-end encryption
- **Webhook events**: HTTP webhook callbacks
- **Channel statistics**: Channel occupancy data
- **Client events**: Client-to-client events (client-*)
- **Socket ID filtering**: Excluding specific sockets from events

These features are rarely used in the current codebase and can be added if needed.

### Behavioral Differences

- **Event delivery timing**: Mock delivers events synchronously; real Pusher has network latency
- **Connection state**: Mock is always "connected"; real Pusher can disconnect
- **Rate limiting**: Mock has no rate limits; real Pusher enforces API limits
- **Message size**: Mock has no size limits; real Pusher has 10KB limit per message
- **Cross-process communication**: Mock only works within same Node.js process

## Troubleshooting

### Events Not Received

Check subscription order:

```typescript
// ❌ Wrong: Trigger before subscribe
await pusherServer.trigger("task-123", "event", data);
const channel = pusher.subscribe("task-123");
channel.bind("event", callback);

// ✅ Correct: Subscribe before trigger
const channel = pusher.subscribe("task-123");
channel.bind("event", callback);
await pusherServer.trigger("task-123", "event", data);
```

### Multiple Event Deliveries

Check for duplicate subscriptions:

```typescript
// ❌ Wrong: Multiple bindings
channel.bind("event", callback);
channel.bind("event", callback); // Duplicate!

// ✅ Correct: Unbind before re-binding
channel.unbind("event", callback);
channel.bind("event", callback);
```

### Memory Leaks

Always cleanup subscriptions:

```typescript
useEffect(() => {
  const pusher = getPusherClient();
  const channel = pusher.subscribe("task-123");

  channel.bind("event", handleEvent);

  // Cleanup on unmount
  return () => {
    channel.unbind("event", handleEvent);
    pusher.unsubscribe("task-123");
  };
}, []);
```

### Test Isolation Issues

Reset state between tests:

```typescript
import { pusherMockState } from "@/lib/mock/pusher-state";

beforeEach(() => {
  pusherMockState.reset();
});
```

## Migration Guide

### From Real Pusher to Mock

No code changes required! Just set `USE_MOCKS=true`:

```bash
# .env.local
USE_MOCKS=true
```

### From Mock to Real Pusher

No code changes required! Just set `USE_MOCKS=false` and provide credentials:

```bash
# .env.local
USE_MOCKS=false
PUSHER_APP_ID=your-app-id
PUSHER_KEY=your-key
PUSHER_SECRET=your-secret
PUSHER_CLUSTER=us2
NEXT_PUBLIC_PUSHER_KEY=your-key
NEXT_PUBLIC_PUSHER_CLUSTER=us2
```

## Benefits

1. **Zero Setup**: No Pusher account needed for development
2. **Fast Iteration**: Instant event delivery without network latency
3. **Cost Free**: No API usage charges during development
4. **Deterministic**: Predictable behavior for testing
5. **Offline**: Work without internet connection
6. **Debugging**: Full visibility into event flow
7. **Multi-tab**: Test real-time synchronization locally

## Related Documentation

- [Mock System Overview](./MOCK_SYSTEM.md)
- [GitHub Mock Endpoints](./GITHUB_MOCK_ENDPOINTS.md)
- [Stakgraph Mock Endpoints](./STAKGRAPH_MOCK_ENDPOINTS.md)
- [Swarm Mock Endpoints](./SWARM_MOCK_ENDPOINTS.md)
- [Real-time Chat Feature](../CLAUDE.md#real-time-chat-feature)

## Summary

The Pusher mock implementation provides a complete, production-grade replacement for the real Pusher service during development and testing. It maintains full API compatibility while offering superior debugging capabilities and eliminating external dependencies.

When `USE_MOCKS=true`, developers can work on real-time features without any Pusher configuration, making onboarding instant and development friction-free.