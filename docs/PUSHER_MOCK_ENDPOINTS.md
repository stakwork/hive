# Pusher Mock Endpoints

This document describes the in-memory Pusher mock implementation for local development and testing.

## Overview

When `USE_MOCKS=true`, the application uses an in-memory mock for both server-side (`pusher`) and client-side (`pusher-js`) Pusher SDKs. This enables:

- Local development without Pusher credentials
- Testing without network calls or external dependencies
- Synchronous event delivery for predictable test behavior
- Event history inspection for debugging

## Configuration

### Environment Variables

Set `USE_MOCKS=true` in your `.env.local` file:

```bash
USE_MOCKS=true
```

When enabled, the following Pusher credentials are automatically provided:
- `PUSHER_APP_ID`: "mock-app-id"
- `PUSHER_KEY`: "mock-pusher-key"
- `PUSHER_SECRET`: "mock-pusher-secret"
- `PUSHER_CLUSTER`: "mock-cluster"

Real Pusher credentials are not required in mock mode.

## How It Works

### Architecture

The mock system consists of three components:

1. **PusherMockState** (`src/lib/mock/pusher-state.ts`)
   - Singleton state manager
   - Tracks channels, subscriptions, and event handlers
   - Records event history for debugging
   - Handles synchronous event delivery

2. **PusherServerMock** (`src/lib/mock/pusher-server-wrapper.ts`)
   - Mimics `pusher` npm package server interface
   - Implements `trigger()` and `triggerBatch()` methods
   - Routes events through PusherMockState

3. **PusherClientMock** (`src/lib/mock/pusher-client-wrapper.ts`)
   - Mimics `pusher-js` client interface
   - Implements `subscribe()`, `unsubscribe()`, `bind()`, `unbind()` methods
   - Routes subscriptions through PusherMockState

### Event Flow

```
Server Side (API Route)                     Client Side (React Hook)
─────────────────────                       ────────────────────────

pusherServer.trigger()                      pusher.subscribe(channel)
       │                                           │
       ├──> PusherMockState.trigger()             ├──> PusherMockState.subscribe()
       │                                           │
       └──> Records event history                  └──> channel.bind(event, callback)
       │                                                      │
       └──> Delivers to subscribed handlers  <───────────────┘
                      │
                      └──> callback(data) [synchronous]
```

**Key Difference from Real Pusher:**
- Real Pusher: Events travel over WebSocket (asynchronous, network delay)
- Mock Pusher: Events delivered synchronously in-memory (immediate)

This means in tests, events are delivered immediately without `await` or delays.

## API Endpoints

### GET /api/mock/pusher/info

Retrieve current mock state for debugging.

**Query Parameters:**
- `channel` (optional): Filter event history by channel name
- `limit` (optional): Maximum events to return (default: 100)

**Response:**
```json
{
  "stats": {
    "channelCount": 3,
    "totalHandlers": 5,
    "eventHistorySize": 42
  },
  "subscriptions": [
    "task-123",
    "workspace-my-workspace"
  ],
  "eventHistory": [
    {
      "channelName": "task-123",
      "eventName": "new-message",
      "data": { "messageId": "msg-456" },
      "timestamp": "2024-01-15T10:30:00.000Z"
    }
  ],
  "useMocks": true
}
```

**Example:**
```bash
# Get all state
curl http://localhost:3000/api/mock/pusher/info

# Get events for specific channel
curl "http://localhost:3000/api/mock/pusher/info?channel=task-123&limit=50"
```

### POST /api/mock/pusher/info

Reset mock state (clear all subscriptions and event history).

**Response:**
```json
{
  "message": "Pusher mock state reset successfully",
  "stats": {
    "channelCount": 0,
    "totalHandlers": 0,
    "eventHistorySize": 0
  }
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/mock/pusher/info
```

## Usage Examples

### Server-Side (Triggering Events)

```typescript
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";

// Trigger an event (works with both real and mock Pusher)
await pusherServer.trigger(
  getTaskChannelName("task-123"),
  PUSHER_EVENTS.NEW_MESSAGE,
  { messageId: "msg-456" }
);

// Trigger on multiple channels
await pusherServer.trigger(
  ["task-123", "workspace-my-workspace"],
  "some-event",
  { data: "value" }
);
```

### Client-Side (Subscribing to Events)

```typescript
import { getPusherClient, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";

// Subscribe to a channel (works with both real and mock Pusher)
const pusher = getPusherClient();
const channel = pusher.subscribe(getTaskChannelName("task-123"));

// Bind event handler
channel.bind(PUSHER_EVENTS.NEW_MESSAGE, (data) => {
  console.log("New message:", data.messageId);
});

// Cleanup
channel.unbind(PUSHER_EVENTS.NEW_MESSAGE);
pusher.unsubscribe(getTaskChannelName("task-123"));
```

### Testing

```typescript
import { pusherMockState } from "@/lib/mock/pusher-state";

describe("Chat integration", () => {
  beforeEach(() => {
    // Reset mock state before each test
    pusherMockState.reset();
  });

  it("should broadcast message to subscribers", async () => {
    const messageReceived = vi.fn();
    
    // Subscribe to channel
    const pusher = getPusherClient();
    const channel = pusher.subscribe("task-123");
    channel.bind("new-message", messageReceived);
    
    // Trigger event from server
    await pusherServer.trigger("task-123", "new-message", { 
      messageId: "msg-456" 
    });
    
    // In mock mode, event is delivered synchronously
    expect(messageReceived).toHaveBeenCalledWith({ messageId: "msg-456" });
    
    // Verify event was recorded
    const history = pusherMockState.getEventHistory("task-123");
    expect(history).toHaveLength(1);
    expect(history[0].eventName).toBe("new-message");
  });
});
```

## Supported Features

### ✅ Implemented
- Channel subscription/unsubscription
- Event binding/unbinding
- Event triggering (single and batch)
- Multiple handlers per event
- Multiple channels
- Event history tracking
- State inspection and reset
- Connection state simulation

### ❌ Not Implemented (Out of Scope)
- Presence channels
- Private channels
- Channel authentication
- Webhooks
- Encrypted channels
- Connection state events (beyond basic "connected")

These features are not used by the application and are not included in the mock.

## Debugging Tips

### Check Current State

Use the diagnostic endpoint to inspect what's happening:

```bash
# See all subscriptions and recent events
curl http://localhost:3000/api/mock/pusher/info | jq

# Filter by channel
curl "http://localhost:3000/api/mock/pusher/info?channel=task-123" | jq
```

### Common Issues

**Events not being received:**
1. Verify subscription: Check that `subscribe()` was called before `trigger()`
2. Check channel name: Ensure server and client use exact same channel name
3. Check event name: Ensure `bind()` and `trigger()` use exact same event name

**Tests failing intermittently:**
1. Reset state: Call `pusherMockState.reset()` in `beforeEach()`
2. Check async: Mock events are synchronous - no need for `await` on client side
3. Handler leaks: Ensure `unbind()` is called in cleanup

### Event History

Event history is maintained in memory (max 1000 events). Use it to debug:

```typescript
// Get recent events for a channel
const events = pusherMockState.getEventHistory("task-123", 10);
console.log("Last 10 events:", events);

// Get all subscriptions
const subs = pusherMockState.getSubscriptions();
console.log("Active channels:", subs);

// Get statistics
const stats = pusherMockState.getStats();
console.log("Stats:", stats);
```

## Limitations

1. **Synchronous Delivery**: Events are delivered immediately without network latency. Tests may need adjustment if they rely on async behavior.

2. **No Network Errors**: Mock never fails. Real Pusher can have connection issues, rate limits, etc.

3. **Single Process**: Mock state is in-memory within a single Node.js process. Not shared across multiple server instances.

4. **No Persistence**: Event history is cleared on server restart.

## Migration Guide

### From Real Pusher to Mock

No code changes required! Just set `USE_MOCKS=true`:

```bash
# .env.local
USE_MOCKS=true
```

The application automatically uses mocks when this flag is set.

### From Mock to Real Pusher

Add real Pusher credentials and disable mocks:

```bash
# .env.local
USE_MOCKS=false
PUSHER_APP_ID=your-app-id
PUSHER_KEY=your-key
PUSHER_SECRET=your-secret
PUSHER_CLUSTER=your-cluster

# For client-side (Next.js public vars)
NEXT_PUBLIC_PUSHER_KEY=your-key
NEXT_PUBLIC_PUSHER_CLUSTER=your-cluster
```

## Related Files

- `src/lib/pusher.ts` - Main Pusher integration (conditionally uses mock)
- `src/lib/mock/pusher-state.ts` - Mock state manager
- `src/lib/mock/pusher-server-wrapper.ts` - Server-side mock
- `src/lib/mock/pusher-client-wrapper.ts` - Client-side mock
- `src/config/env.ts` - Environment configuration with mock credentials
- `src/app/api/mock/pusher/info/route.ts` - Diagnostic endpoint

## See Also

- [Real-time Chat Documentation](../REAL_TIME_CHAT.md) - How chat uses Pusher
- [Mock Endpoints Summary](../MOCK_ENDPOINTS_SUMMARY.md) - All mock services
- [Testing Guidelines](../TESTING.md) - Testing real-time features
