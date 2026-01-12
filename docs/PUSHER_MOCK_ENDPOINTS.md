# Pusher Mock API Endpoints

This document describes the mock Pusher API endpoints available when `USE_MOCKS=true`. These endpoints enable local development and testing without requiring real Pusher credentials or WebSocket connections.

## Overview

The Pusher mock system provides HTTP-based alternatives to Pusher's real-time WebSocket API:

- **Server-side**: `pusherServer.trigger()` routes to `/api/mock/pusher/trigger`
- **Client-side**: HTTP polling replaces WebSocket subscriptions
- **State**: In-memory event storage with automatic cleanup
- **Testing**: Reset endpoint for test isolation

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Application Code                        │
│  (No changes required - transparent mock routing)            │
└────────────────┬───────────────────────────────┬─────────────┘
                 │                               │
                 │ USE_MOCKS=true                │
                 ▼                               ▼
┌────────────────────────────┐  ┌──────────────────────────────┐
│   pusherServer.trigger()   │  │  usePusherConnection hook    │
│   (Server-side)            │  │  (Client-side polling)       │
└────────────┬───────────────┘  └────────────┬─────────────────┘
             │                               │
             │ POST /trigger                 │ GET /events
             ▼                               ▼
┌─────────────────────────────────────────────────────────────┐
│              MockPusherStateManager (Singleton)              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Event Queues: Map<channel, Event[]>                  │   │
│  │ - task-{taskId}: [...events]                         │   │
│  │ - workspace-{slug}: [...events]                      │   │
│  └──────────────────────────────────────────────────────┘   │
│  • Max 100 events per channel                                │
│  • 5-minute retention                                        │
│  • Deduplication via lastEventId                             │
└─────────────────────────────────────────────────────────────┘
```

## Endpoints

### POST /api/mock/pusher/trigger

Stores events from server-side `pusherServer.trigger()` calls.

**Request Body:**
```json
{
  "channels": ["task-123", "workspace-acme"],
  "event": "new-message",
  "data": { "messageId": "msg-456" }
}
```

**Response:**
```json
{
  "success": true,
  "channels": ["task-123", "workspace-acme"]
}
```

**Usage in Code:**
```typescript
// Server-side API route
await pusherServer.trigger(
  "task-123",
  PUSHER_EVENTS.NEW_MESSAGE,
  { messageId: message.id }
);
// Automatically routes to /api/mock/pusher/trigger when USE_MOCKS=true
```

### GET /api/mock/pusher/events

Polls for new events on a channel (client-side).

**Query Parameters:**
- `channel` (required): Channel name (e.g., `task-123`)
- `lastEventId` (optional): Last seen event ID for deduplication

**Request:**
```
GET /api/mock/pusher/events?channel=task-123&lastEventId=evt_1234567890_1
```

**Response:**
```json
{
  "channel": "task-123",
  "events": [
    {
      "id": "evt_1234567891_2",
      "channel": "task-123",
      "eventName": "new-message",
      "data": { "messageId": "msg-456" },
      "timestamp": 1234567891000
    }
  ],
  "timestamp": 1234567892000
}
```

**Usage:**
The `usePusherConnection` hook automatically polls this endpoint every 500ms when `USE_MOCKS=true`:

```typescript
// Client component
const { isConnected } = usePusherConnection({
  taskId: "123",
  onMessage: (data) => console.log("New message:", data),
});
// Polling happens automatically in mock mode
```

### POST /api/mock/pusher/subscribe

Simulates channel subscription.

**Request Body:**
```json
{
  "channel": "task-123"
}
```

**Response:**
```json
{
  "success": true,
  "subscription": {
    "channel": "task-123",
    "subscriptionId": "sub_1234567890_abc123",
    "subscribedAt": 1234567890000
  }
}
```

### DELETE /api/mock/pusher/subscribe

Unsubscribes from a channel.

**Query Parameters:**
- `subscriptionId` (required): Subscription ID from subscribe response

**Request:**
```
DELETE /api/mock/pusher/subscribe?subscriptionId=sub_1234567890_abc123
```

**Response:**
```json
{
  "success": true,
  "subscriptionId": "sub_1234567890_abc123"
}
```

### POST /api/mock/pusher/reset

Resets all mock state (for testing).

**Request:** No body required

**Response:**
```json
{
  "success": true,
  "message": "Mock Pusher state reset successfully",
  "clearedStats": {
    "totalEvents": 42,
    "channelCount": 5,
    "subscriptionCount": 3,
    "eventsByChannel": {
      "task-123": 15,
      "workspace-acme": 27
    }
  }
}
```

### GET /api/mock/pusher/reset

Gets current mock state statistics without resetting.

**Response:**
```json
{
  "success": true,
  "stats": {
    "totalEvents": 42,
    "channelCount": 5,
    "subscriptionCount": 3,
    "eventsByChannel": {
      "task-123": 15,
      "workspace-acme": 27
    }
  }
}
```

## Supported Pusher Events

All standard Pusher events are supported in mock mode:

- `NEW_MESSAGE` - Chat message notifications
- `WORKFLOW_STATUS_UPDATE` - Workflow state changes
- `TASK_TITLE_UPDATE` - Task title changes (task channel)
- `WORKSPACE_TASK_TITLE_UPDATE` - Task title changes (workspace channel)
- `RECOMMENDATIONS_UPDATED` - Test recommendation updates
- `STAKWORK_RUN_UPDATE` - Stakwork workflow updates
- `STAKWORK_RUN_DECISION` - Stakwork decision events
- `HIGHLIGHT_NODES` - Graph node highlighting
- `FOLLOW_UP_QUESTIONS` - AI follow-up questions
- `PROVENANCE_DATA` - Provenance information

## Channel Naming

Channels follow the same naming conventions as real Pusher:

- **Task channels**: `task-{taskId}` (e.g., `task-123`)
- **Workspace channels**: `workspace-{slug}` (e.g., `workspace-acme`)

Helper functions are available:

```typescript
import { getTaskChannelName, getWorkspaceChannelName } from "@/lib/pusher";

const taskChannel = getTaskChannelName("123"); // "task-123"
const workspaceChannel = getWorkspaceChannelName("acme"); // "workspace-acme"
```

## Event Payload Examples

### NEW_MESSAGE
```json
{
  "messageId": "msg-456"
}
```
Client fetches full message via `/api/chat/messages/msg-456`

### WORKFLOW_STATUS_UPDATE
```json
{
  "taskId": "123",
  "workflowStatus": "IN_PROGRESS"
}
```

### TASK_TITLE_UPDATE
```json
{
  "taskId": "123",
  "newTitle": "Updated Task Title",
  "previousTitle": "Old Task Title"
}
```

### RECOMMENDATIONS_UPDATED
```json
{
  "workspaceSlug": "acme",
  "newRecommendationCount": 5,
  "totalRecommendationCount": 15
}
```

## Testing with Mock Pusher

### Integration Tests

Reset mock state before each test:

```typescript
import { mockPusherState } from "@/lib/mock/pusher-state";

describe("Chat API", () => {
  beforeEach(() => {
    mockPusherState.reset();
  });

  it("should trigger NEW_MESSAGE event", async () => {
    // Trigger event
    await pusherServer.trigger("task-123", "new-message", { messageId: "msg-1" });

    // Poll for events
    const events = mockPusherState.getEvents("task-123");
    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe("new-message");
  });
});
```

### Manual Testing

1. Set environment variable:
   ```bash
   USE_MOCKS=true
   ```

2. Start dev server:
   ```bash
   npm run dev
   ```

3. Check mock state:
   ```bash
   curl http://localhost:3000/api/mock/pusher/reset
   ```

4. Trigger test event:
   ```bash
   curl -X POST http://localhost:3000/api/mock/pusher/trigger \
     -H "Content-Type: application/json" \
     -d '{"channels": ["task-123"], "event": "test-event", "data": {"test": true}}'
   ```

5. Poll for events:
   ```bash
   curl "http://localhost:3000/api/mock/pusher/events?channel=task-123"
   ```

## Mock State Management

### Event Storage

- **Max events per channel**: 100 (FIFO)
- **Retention period**: 5 minutes
- **Deduplication**: Via `lastEventId` parameter
- **Cleanup**: Automatic on timer + manual via reset

### Subscriptions

- Tracked per client connection
- Automatically cleaned up on disconnect
- No WebSocket connections maintained

### Statistics

Get current state:

```typescript
const stats = mockPusherState.getStats();
console.log(stats);
// {
//   totalEvents: 42,
//   channelCount: 5,
//   subscriptionCount: 3,
//   eventsByChannel: { ... }
// }
```

## Environment Configuration

### Mock Mode (Development/Testing)

```bash
# .env.local
USE_MOCKS=true
MOCK_BASE=http://localhost:3000

# Pusher credentials not required in mock mode
# Mock values automatically provided
```

### Production Mode

```bash
# .env.production
USE_MOCKS=false

# Real Pusher credentials required
PUSHER_APP_ID=your_app_id
PUSHER_KEY=your_key
PUSHER_SECRET=your_secret
PUSHER_CLUSTER=your_cluster
NEXT_PUBLIC_PUSHER_KEY=your_key
NEXT_PUBLIC_PUSHER_CLUSTER=your_cluster
```

## Limitations

1. **No WebSocket connections**: Polling-based architecture with 500ms intervals
2. **Single-server only**: In-memory state not shared across server instances
3. **No presence channels**: Presence feature not implemented in mock
4. **No private channels**: Authentication simulation only
5. **Event retention**: Limited to 5 minutes or 100 events per channel

## Debugging

Enable debug logging:

```bash
LOG_LEVEL=DEBUG npm run dev
```

Look for `[MockPusher]` log entries:

```
[MockPusher] Event triggered { channel: 'task-123', eventName: 'new-message', eventId: 'evt_...' }
[MockPusher] Polling started { channel: 'task-123', interval: 500 }
[MockPusher] Events polled { channel: 'task-123', lastEventId: 'evt_...', eventCount: 2 }
```

## Migration from Real Pusher

No code changes required! Simply toggle the `USE_MOCKS` environment variable:

```typescript
// This code works in both real and mock modes
await pusherServer.trigger("task-123", "new-message", data);

const { isConnected } = usePusherConnection({
  taskId: "123",
  onMessage: handleMessage,
});
```

The mock system maintains API compatibility with real Pusher.