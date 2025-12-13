# Pusher Mock Implementation

## Overview

The Pusher Mock provides an in-memory implementation of Pusher's real-time messaging service for local development and testing. When `USE_MOCKS=true`, all Pusher API calls are handled by mock implementations that simulate the real Pusher behavior without requiring credentials or external connections.

## Architecture

### Components

1. **PusherMockState** (`src/lib/mock/pusher-state.ts`)
   - Singleton state manager for channels, connections, and event handlers
   - Enables cross-tab synchronization via shared singleton state
   - Manages event broadcasting to all subscribed clients

2. **MockPusherServer** (`src/lib/mock/pusher-server.ts`)
   - Mimics server-side Pusher API for triggering events
   - Compatible with existing server code using `pusher` package
   - Supports `trigger()`, `triggerBatch()`, and channel info queries

3. **MockPusherClient** (`src/lib/mock/pusher-client.ts`)
   - Mimics browser-side `pusher-js` API for receiving events
   - Simulates connection lifecycle (connecting → connected)
   - Supports channel subscription, event binding, and automatic `pusher:subscription_succeeded` events

4. **Pusher Wrapper** (`src/lib/pusher.ts`)
   - Conditionally uses mock or real Pusher based on `USE_MOCKS` flag
   - Provides `pusherServer` and `getPusherClient()` exports
   - No code changes required in feature code to switch between mock and real

### Data Flow

```
Server-side trigger:
pusherServer.trigger(channel, event, data)
  ↓
MockPusherServer.trigger()
  ↓
PusherMockState.trigger()
  ↓
All registered handlers called

Client-side subscription:
client.subscribe(channel).bind(event, handler)
  ↓
MockPusherClient.subscribe() → MockChannel.bind()
  ↓
PusherMockState.bind(channel, event, handler)
  ↓
Handler registered for future events
```

## Configuration

### Environment Variables

Add to your `.env.local`:

```bash
# Enable mock mode for all external services
USE_MOCKS=true

# Pusher credentials are optional when USE_MOCKS=true
# Mock values will be used automatically if these are not set
# PUSHER_APP_ID="mock-pusher-app-id"
# PUSHER_KEY="mock-pusher-key"
# PUSHER_SECRET="mock-pusher-secret"
# PUSHER_CLUSTER="mock-cluster"
# NEXT_PUBLIC_PUSHER_KEY="mock-pusher-key"
# NEXT_PUBLIC_PUSHER_CLUSTER="mock-cluster"
```

### Credential Getters

Environment configuration functions in `src/config/env.ts` automatically return mock values when `USE_MOCKS=true`:

- `getPusherAppId()` → `"mock-pusher-app-id"`
- `getPusherKey()` → `"mock-pusher-key"`
- `getPusherSecret()` → `"mock-pusher-secret"`
- `getPusherCluster()` → `"mock-cluster"`
- `getPublicPusherKey()` → `"mock-pusher-key"`
- `getPublicPusherCluster()` → `"mock-cluster"`

## Supported Features

### ✅ Fully Supported

- **Server-side event triggering**: `pusherServer.trigger(channel, event, data)`
- **Client-side channel subscription**: `client.subscribe(channelName)`
- **Event binding**: `channel.bind(eventName, handler)`
- **Event unbinding**: `channel.unbind(eventName, handler)`
- **Channel unsubscription**: `client.unsubscribe(channelName)`
- **Connection lifecycle**: Connection state changes (connecting → connected)
- **Automatic subscription events**: `pusher:subscription_succeeded`
- **Cross-tab synchronization**: All tabs share the same singleton state
- **Multiple channels**: Subscribe to multiple channels simultaneously
- **Multiple handlers**: Multiple handlers per event
- **Batch triggering**: `pusherServer.triggerBatch(batch)`

### ⚠️ Partially Supported

- **Private channels**: Mock auth returns dummy signatures but doesn't validate
- **Presence channels**: Mock auth works but presence data is not tracked
- **Channel info queries**: Basic implementation returns subscriber counts
- **Connection binding**: `connection.bind()` works but state changes are simplified

### ❌ Not Supported

- **Webhooks**: No mock webhook endpoints
- **Client events**: Client-to-client events not implemented
- **Global event binding**: `client.bind()` logs warning (use channel-specific binding instead)

## Usage

### Server-Side (API Routes)

No code changes required - existing code works with both mock and real Pusher:

```typescript
import { pusherServer } from "@/lib/pusher";

// Trigger an event (works with both mock and real)
await pusherServer.trigger("task-123", "message-new", {
  messageId: "msg-456",
});

// Trigger on multiple channels
await pusherServer.trigger(
  ["task-123", "workspace-abc"],
  "task-title-update",
  { taskId: "123", title: "New Title" }
);

// Batch trigger
await pusherServer.triggerBatch([
  { channel: "task-123", name: "event-1", data: { foo: "bar" } },
  { channel: "workspace-abc", name: "event-2", data: { baz: "qux" } },
]);
```

### Client-Side (React Components)

No code changes required - existing code works with both mock and real Pusher:

```typescript
import { getPusherClient } from "@/lib/pusher";

// Get Pusher client (mock or real based on USE_MOCKS)
const pusher = getPusherClient();

// Subscribe to channel
const channel = pusher.subscribe("task-123");

// Bind event handler
channel.bind("message-new", (data) => {
  console.log("New message:", data);
});

// Unbind handler
channel.unbind("message-new", handler);

// Unsubscribe from channel
pusher.unsubscribe("task-123");
```

### Testing

Mock state is automatically reset between tests when using the shared test setup. For manual reset:

```typescript
import { pusherMockState } from "@/lib/mock/pusher-state";

// Reset all channels, connections, and handlers
pusherMockState.reset();

// Get statistics about mock state
const stats = pusherMockState.getStats();
console.log(stats); // { connectionCount, channelCount, totalHandlers }

// Manually trigger events for testing
pusherMockState.trigger("task-123", "test-event", { test: true });
```

## Real-Time Features Working with Mock

All existing real-time features work seamlessly with the mock:

### Task Chat Messages
- **Event**: `message-new` on `task-{taskId}` channels
- **Flow**: API broadcasts message ID → Client fetches full message → UI updates

### Task Title Updates
- **Events**: 
  - `task-title-update` on `task-{taskId}` channels
  - `workspace-task-title-update` on `workspace-{slug}` channels
- **Flow**: API updates database → Broadcasts to task and workspace channels → All clients update UI

### Workflow Status Updates
- **Event**: `workflow-status-update` on `task-{taskId}` channels
- **Flow**: Workflow service updates status → Broadcasts to task channel → UI shows status badge

### Janitor Recommendations
- **Event**: `recommendations-updated` on `workspace-{slug}` channels
- **Flow**: Janitor run completes → Broadcasts to workspace → Toast notification appears

### Stakgraph Highlights
- **Event**: `highlight-nodes` on `workspace-{slug}` channels
- **Flow**: User hovers over recommendation → Broadcasts node IDs → Graph highlights nodes

## Multiple Browser Tabs

The mock fully supports cross-tab synchronization because all tabs share the same singleton `PusherMockState` instance:

1. **Tab A** subscribes to `task-123` and binds a handler
2. **Tab B** subscribes to `task-123` and binds a handler
3. **Server** triggers event on `task-123`
4. **Both Tab A and Tab B** receive the event and execute their handlers

This matches real Pusher behavior where all clients subscribed to a channel receive broadcasted events.

## Limitations

### In-Memory State Only
- State is lost on server restart or page refresh
- No persistence layer (events are ephemeral)
- Each Node.js process has its own state (not suitable for multi-instance deployments)

### Single-Process Only
- Works for local development (single Next.js dev server)
- Works for testing (single test process)
- **Does NOT work** across multiple server instances (e.g., production cluster)

### Connection Simulation
- Connection state changes are simplified
- No network latency simulation
- No connection failure scenarios

### Private/Presence Channels
- Authentication returns dummy signatures
- No actual authorization checks
- Presence data not tracked

## Transition to Production

### Step 1: Set Up Real Pusher

1. Create a free Pusher account at https://pusher.com
2. Create a new Pusher app in the dashboard
3. Copy the credentials (App ID, Key, Secret, Cluster)

### Step 2: Update Environment Variables

In your production environment (Vercel, AWS, etc.):

```bash
# Disable mocks
USE_MOCKS=false

# Add real Pusher credentials
PUSHER_APP_ID="your-real-app-id"
PUSHER_KEY="your-real-key"
PUSHER_SECRET="your-real-secret"
PUSHER_CLUSTER="your-real-cluster"
NEXT_PUBLIC_PUSHER_KEY="your-real-key"
NEXT_PUBLIC_PUSHER_CLUSTER="your-real-cluster"
```

### Step 3: Deploy

No code changes required - the application automatically uses real Pusher when `USE_MOCKS=false`.

### Step 4: Verify

Test real-time features in production:
- Open multiple browser tabs
- Trigger events (send chat messages, update task titles, etc.)
- Verify all tabs receive updates in real-time

## Troubleshooting

### Events Not Received

**Symptom**: Client handlers not called when server triggers events

**Possible Causes**:
1. **Channel name mismatch**: Ensure server trigger and client subscription use exact same channel name
2. **Event name mismatch**: Ensure server trigger and client binding use exact same event name
3. **Subscription timing**: Client must subscribe before server triggers event

**Solution**:
```typescript
// Check channel and event names match exactly
const channelName = getTaskChannelName(taskId); // Both client and server
const eventName = PUSHER_EVENTS.NEW_MESSAGE; // Use constants

// Ensure subscription completes before triggering
const channel = pusher.subscribe(channelName);
channel.bind("pusher:subscription_succeeded", () => {
  // Now safe to trigger events
});
```

### Multiple Handler Calls

**Symptom**: Handler function called multiple times for single event

**Possible Causes**:
1. **Multiple bindings**: Handler bound multiple times without unbinding
2. **Component re-renders**: React component re-binds handler on each render

**Solution**:
```typescript
// Use useEffect with proper cleanup
useEffect(() => {
  const channel = pusher.subscribe(channelName);
  
  const handler = (data) => {
    // Handle event
  };
  
  channel.bind(eventName, handler);
  
  return () => {
    channel.unbind(eventName, handler); // Cleanup on unmount
  };
}, [channelName, eventName]); // Stable dependencies
```

### State Not Shared Between Tabs

**Symptom**: Events triggered in one tab don't appear in other tabs

**Expected Behavior**: This is **correct** for the mock - tabs share state only within the same browser session. Real Pusher works across all clients globally.

**Solution**: Use real Pusher in production for true cross-client synchronization.

## Testing Best Practices

### Reset State Between Tests

```typescript
import { pusherMockState } from "@/lib/mock/pusher-state";

beforeEach(() => {
  pusherMockState.reset();
});
```

### Test Event Broadcasting

```typescript
it("should broadcast events to all subscribers", () => {
  const handler1 = vi.fn();
  const handler2 = vi.fn();
  
  // Subscribe two clients
  pusherMockState.bind("test-channel", "test-event", handler1);
  pusherMockState.bind("test-channel", "test-event", handler2);
  
  // Trigger event
  pusherMockState.trigger("test-channel", "test-event", { test: true });
  
  // Both handlers should be called
  expect(handler1).toHaveBeenCalledWith({ test: true });
  expect(handler2).toHaveBeenCalledWith({ test: true });
});
```

### Test Async Event Delivery

Events are delivered asynchronously via `setTimeout(0)`, so use `waitFor()` in tests:

```typescript
import { waitFor } from "@testing-library/react";

it("should receive event asynchronously", async () => {
  const handler = vi.fn();
  
  pusherMockState.bind("channel", "event", handler);
  pusherMockState.trigger("channel", "event", { test: true });
  
  await waitFor(() => {
    expect(handler).toHaveBeenCalled();
  });
});
```

## Implementation Notes

### Why Singleton Pattern?

The `PusherMockState` uses a singleton pattern to enable cross-tab synchronization. All `MockPusherClient` and `MockPusherServer` instances share the same state, allowing events triggered by the server to reach all client subscriptions.

### Why setTimeout for Event Delivery?

Event handlers are called via `setTimeout(handler, 0)` to simulate asynchronous delivery, matching real Pusher behavior and preventing issues with synchronous state updates.

### Why Separate Mock Files?

Each component (`pusher-state.ts`, `pusher-server.ts`, `pusher-client.ts`) is separated to:
- Match the structure of real Pusher packages (`pusher`, `pusher-js`)
- Enable independent testing of server and client behavior
- Follow existing mock pattern in the codebase (S3, Anthropic, etc.)

## Related Documentation

- [Mocks Feature Documentation](./MOCKS_FEATURE.md)
- [S3 Mock Endpoints](./S3_MOCK_ENDPOINTS.md)
- [Anthropic Mock Endpoints](./ANTHROPIC_MOCK_ENDPOINTS.md)
- [Real-time Chat Feature](../docs/features/REAL_TIME_CHAT.md)

## Support

For issues or questions about the Pusher mock implementation:
1. Check existing real-time feature tests for usage examples
2. Review Pusher documentation at https://pusher.com/docs
3. Consult the mock implementation source code in `src/lib/mock/pusher-*.ts`
