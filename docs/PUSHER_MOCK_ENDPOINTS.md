# Pusher Mock Endpoints

This document describes the Pusher mock implementation that enables local development and testing without requiring real Pusher credentials.

## Overview

The Pusher mock provides an in-memory event bus that simulates Pusher's pub/sub model within a single Node.js process. It supports all critical Pusher channels and events used by the application for real-time messaging.

## Architecture

### Components

1. **MockPusherState** (`src/lib/mock/pusher-state.ts`)
   - Singleton class managing in-memory channel events and subscribers
   - 60-second TTL for events with automatic cleanup every 10 seconds
   - Methods: `trigger()`, `subscribe()`, `unsubscribe()`, `poll()`, `cleanup()`, `reset()`

2. **Pusher Configuration** (`src/lib/pusher.ts`)
   - Detects `USE_MOCKS=true` and routes to mock implementations
   - Server-side: `pusherServer.trigger()` uses `mockPusherState.trigger()`
   - Client-side: `getPusherClient()` returns mock client using `mockPusherState.subscribe()`

3. **Polling API** (`src/app/api/mock/pusher/events/route.ts`)
   - Optional HTTP polling endpoint for SSR scenarios
   - GET: Poll for events on specific channels
   - POST: Get statistics or reset mock state

## Configuration

### Enable Mock Mode

Set the following environment variable:

```bash
USE_MOCKS=true
```

### Optional Pusher Credentials

When `USE_MOCKS=true`, Pusher credentials are optional. The mock provides default values:

```bash
PUSHER_APP_ID=mock-app-id
PUSHER_KEY=mock-pusher-key
PUSHER_SECRET=mock-pusher-secret
PUSHER_CLUSTER=mock-cluster
NEXT_PUBLIC_PUSHER_KEY=mock-pusher-key
NEXT_PUBLIC_PUSHER_CLUSTER=mock-cluster
```

## Supported Channels

### Task Channels
Format: `task-{taskId}`

Used for task-specific real-time updates:
- New chat messages
- Task title changes
- Workflow status updates

### Workspace Channels
Format: `workspace-{workspaceSlug}`

Used for workspace-level notifications:
- New recommendations
- Task list updates
- Workflow status broadcasts

## Supported Events

### Task Channel Events

| Event | Payload | Description |
|-------|---------|-------------|
| `NEW_MESSAGE` | `string` (messageId) | New chat message available. Client fetches full message from API. |
| `TASK_TITLE_UPDATE` | `TaskTitleUpdateEvent` | Task title changed. |
| `WORKFLOW_STATUS_UPDATE` | `WorkflowStatusUpdate` | Workflow execution status changed. |
| `STAKWORK_RUN_UPDATE` | Task update object | Stakwork workflow run update. |

### Workspace Channel Events

| Event | Payload | Description |
|-------|---------|-------------|
| `WORKSPACE_TASK_TITLE_UPDATE` | `TaskTitleUpdateEvent` | Task title changed (workspace broadcast). |
| `RECOMMENDATIONS_UPDATED` | `RecommendationsUpdatedEvent` | New test recommendations available. |
| `STAKWORK_RUN_UPDATE` | Task update object | Workflow status update (workspace broadcast). |

### Other Events

- `CONNECTION_COUNT` - Connection metadata
- `STAKWORK_RUN_DECISION` - Workflow decision events
- `HIGHLIGHT_NODES` - Node highlighting events
- `FOLLOW_UP_QUESTIONS` - Follow-up question suggestions

## Event Payload Types

### TaskTitleUpdateEvent
```typescript
{
  taskId: string;
  newTitle?: string;
  previousTitle?: string;
  archived?: boolean;
  podId?: string | null;
  timestamp: Date;
}
```

### WorkflowStatusUpdate
```typescript
{
  taskId: string;
  workflowStatus: WorkflowStatus;
  workflowStartedAt?: Date;
  workflowCompletedAt?: Date;
  timestamp: Date;
}
```

### RecommendationsUpdatedEvent
```typescript
{
  workspaceSlug: string;
  newRecommendationCount: number;
  totalRecommendationCount: number;
  timestamp: Date;
}
```

## API Endpoints

### Poll for Events

**GET** `/api/mock/pusher/events?channels={channels}&since={timestamp}`

Poll for events on specific channels.

**Query Parameters:**
- `channels` (required): Comma-separated list of channel names
- `since` (optional): Unix timestamp (ms) - only return events after this time

**Example:**
```bash
curl "http://localhost:3000/api/mock/pusher/events?channels=task-123,workspace-myworkspace&since=1234567890"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "task-123": [
      {
        "event": "NEW_MESSAGE",
        "data": "msg-abc123",
        "timestamp": 1234567900
      }
    ],
    "workspace-myworkspace": [
      {
        "event": "RECOMMENDATIONS_UPDATED",
        "data": {
          "workspaceSlug": "myworkspace",
          "newRecommendationCount": 5,
          "totalRecommendationCount": 42,
          "timestamp": "2024-01-15T10:30:00Z"
        },
        "timestamp": 1234567950
      }
    ]
  },
  "timestamp": 1234568000
}
```

### Get Statistics

**POST** `/api/mock/pusher/events`

Get mock state statistics or reset state.

**Request Body:**
```json
{
  "action": "stats"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "channelCount": 2,
    "totalEventCount": 5,
    "totalSubscriberCount": 3,
    "channels": {
      "task-123": {
        "eventCount": 3,
        "subscriberCount": 2
      },
      "workspace-myworkspace": {
        "eventCount": 2,
        "subscriberCount": 1
      }
    }
  }
}
```

### Reset State

**POST** `/api/mock/pusher/events`

Reset all mock state (useful for tests).

**Request Body:**
```json
{
  "action": "reset"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Mock state reset successfully"
}
```

## Usage Examples

### Server-Side Event Triggering

```typescript
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";

// Trigger a message event
await pusherServer.trigger(
  getTaskChannelName(taskId),
  PUSHER_EVENTS.NEW_MESSAGE,
  messageId
);

// Trigger a workspace event
await pusherServer.trigger(
  getWorkspaceChannelName(workspaceSlug),
  PUSHER_EVENTS.RECOMMENDATIONS_UPDATED,
  {
    workspaceSlug,
    newRecommendationCount: 5,
    totalRecommendationCount: 42,
    timestamp: new Date(),
  }
);
```

### Client-Side Subscription

```typescript
import { usePusherConnection } from "@/hooks/usePusherConnection";

// Subscribe to task channel
const { isConnected, error } = usePusherConnection({
  taskId: "task-123",
  onMessage: (message) => {
    console.log("New message:", message);
  },
  onTaskTitleUpdate: (update) => {
    console.log("Title updated:", update);
  },
});

// Subscribe to workspace channel
const { isConnected } = usePusherConnection({
  workspaceSlug: "myworkspace",
  onRecommendationsUpdated: (update) => {
    console.log("New recommendations:", update);
  },
});
```

## Event Flow

### Message Delivery Flow
1. User sends message → POST `/api/chat/message`
2. Server saves message → triggers `NEW_MESSAGE` event with messageId
3. Mock stores event in memory and invokes client callbacks
4. Client receives messageId → fetches full message from API
5. Message rendered in UI

### Task Update Flow
1. User updates task title → PUT `/api/tasks/{taskId}/title`
2. Server updates database → triggers `TASK_TITLE_UPDATE` (task channel) and `WORKSPACE_TASK_TITLE_UPDATE` (workspace channel)
3. Mock broadcasts to all subscribers on both channels
4. Clients update UI with new title

## Event Lifecycle

### TTL and Cleanup
- Events are stored in memory for 60 seconds
- Automatic cleanup runs every 10 seconds
- Expired events are removed to prevent memory growth
- Channels with no subscribers and no events are automatically cleaned up

### Subscription Lifecycle
1. Client calls `getPusherClient().subscribe(channelName)`
2. Mock creates channel object with `bind()` methods
3. Mock triggers `pusher:subscription_succeeded` event after 10ms
4. Client can now bind event handlers via `channel.bind(eventName, callback)`
5. On unmount, client calls `channel.unbind_all()` and `pusher.unsubscribe(channelName)`

## Testing

### Unit Tests

Test the mock state manager directly:

```typescript
import { mockPusherState } from "@/lib/mock/pusher-state";

describe("MockPusherState", () => {
  beforeEach(() => {
    mockPusherState.reset();
  });

  it("should trigger and receive events", () => {
    const callback = vi.fn();
    const channel = mockPusherState.subscribe("test-channel");
    channel.bind("test-event", callback);

    mockPusherState.trigger("test-channel", "test-event", { foo: "bar" });

    expect(callback).toHaveBeenCalledWith({ foo: "bar" });
  });

  it("should clean up expired events", async () => {
    mockPusherState.trigger("test-channel", "test-event", { data: 1 });

    // Wait for TTL to expire (60s) + cleanup interval (10s)
    await new Promise((resolve) => setTimeout(resolve, 71000));

    const events = mockPusherState.getChannelEvents("test-channel");
    expect(events).toHaveLength(0);
  });
});
```

### Integration Tests

Integration tests automatically use the mock when `USE_MOCKS=true`:

```typescript
import { expect, test } from "vitest";

test("chat message creates and broadcasts event", async () => {
  const response = await authenticatedRequest(userId)
    .post(`/api/chat/message`)
    .send({
      taskId,
      content: "Hello world",
    });

  expect(response.status).toBe(200);

  // Event was triggered in mock
  const stats = mockPusherState.getStats();
  expect(stats.channelCount).toBeGreaterThan(0);
});
```

## Limitations

### Single Process Only
The mock operates within a single Node.js process. It does not support:
- Multi-process deployments
- Multiple server instances
- Distributed systems

For production, use real Pusher.

### No Network Simulation
The mock does not simulate:
- Network latency
- Connection failures
- Rate limits
- Message ordering issues

Events are delivered synchronously and instantly.

### No Persistence
Events are stored in memory only and are lost on process restart. For testing scenarios requiring persistence, use real Pusher or implement custom persistence in the mock.

## Troubleshooting

### Events Not Being Received

**Symptom:** Client subscriptions succeed but events are not received.

**Solution:**
1. Verify `USE_MOCKS=true` is set in environment
2. Check that server and client are both using the mock (check logs)
3. Ensure channel names match exactly (e.g., `task-123` not `task-123-extra`)
4. Verify event names match constants in `PUSHER_EVENTS`

### Memory Growth

**Symptom:** Application memory usage grows over time.

**Solution:**
1. Verify cleanup interval is running (check logs)
2. Ensure TTL is appropriate for your use case (default 60s)
3. Check for subscriber leaks (unsubscribe on unmount)
4. Call `mockPusherState.reset()` between tests

### Subscription Errors

**Symptom:** `pusher:subscription_error` events triggered.

**Solution:**
1. This should not happen with the mock (no real connection failures)
2. Check for errors in subscriber callbacks (exceptions are caught and logged)
3. Verify channel names are valid strings

## Migration from Real Pusher

To migrate from real Pusher to the mock:

1. Set `USE_MOCKS=true` in `.env.local`
2. Remove or comment out real Pusher credentials (optional)
3. Restart development server
4. No code changes required - mock is transparent

To migrate back to real Pusher:

1. Set `USE_MOCKS=false` or remove the variable
2. Ensure valid Pusher credentials are configured
3. Restart development server

## Related Files

- `src/lib/pusher.ts` - Pusher configuration and channel helpers
- `src/lib/mock/pusher-state.ts` - Mock state manager
- `src/hooks/usePusherConnection.ts` - Client-side subscription hook
- `src/app/api/chat/message/route.ts` - Chat message API (server-side trigger)
- `src/app/api/chat/response/route.ts` - Chat response webhook (server-side trigger)
- `src/app/api/tasks/[taskId]/title/route.ts` - Task title API (server-side trigger)

## Future Enhancements

Potential improvements for the mock:

- Polling fallback for SSR (already implemented)
- Event persistence (Redis or database)
- Network simulation (latency, failures)
- Connection state tracking
- Message history support
- Multi-instance synchronization