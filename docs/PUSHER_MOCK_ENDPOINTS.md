# Pusher Mock System Documentation

## Overview

The Pusher mock system provides in-memory real-time messaging for local development, eliminating the need for Pusher credentials during development and testing.

## Enabling Mock Mode

Set `USE_MOCKS=true` in your environment:

```bash
# .env.local
USE_MOCKS=true
```

When enabled:
- No Pusher credentials required
- Events delivered synchronously in-memory
- All Pusher features work normally
- Event history available for debugging

## Architecture

### Components

1. **PusherMockState** - Singleton state manager (`src/lib/mock/pusher-state.ts`)
2. **PusherServerMock** - Server-side mock wrapper (`src/lib/mock/pusher-server-wrapper.ts`)
3. **PusherClientMock** - Client-side mock wrapper (`src/lib/mock/pusher-client-wrapper.ts`)

### How It Works

```
Backend: pusherServer.trigger(channel, event, data)
    ↓
PusherMockState.trigger()
    ↓
Finds all subscribers to channel
    ↓
Delivers event synchronously to subscribers
    ↓
Frontend: channel.bind(event, callback)
    ↓
Callback invoked immediately
```

## Event Flow

All Pusher events work identically in mock mode:
- `NEW_MESSAGE` - Chat messages
- `WORKFLOW_STATUS_UPDATE` - Status changes
- `TASK_TITLE_UPDATE` - Title updates
- `WORKSPACE_TASK_TITLE_UPDATE` - Workspace-level task updates
- `RECOMMENDATIONS_UPDATED` - New recommendations
- `STAKWORK_RUN_UPDATE` - Stakwork run progress
- `STAKWORK_RUN_DECISION` - Decision requests
- `HIGHLIGHT_NODES` - Graph node highlighting

## Channel Types

- **Task channels**: `task-{taskId}` - Task-specific events
- **Workspace channels**: `workspace-{workspaceSlug}` - Workspace-wide events

## Testing Support

The mock state can be reset for test isolation:

```typescript
import { pusherMockState } from '@/lib/mock/pusher-state';

beforeEach(() => {
  pusherMockState.reset();
});
```

## Debugging

View event history in development:

```typescript
// Get last 10 events on a channel
const history = pusherMockState.getChannelHistory('task-123', 10);
console.log('Recent events:', history);

// Get debug info
const info = pusherMockState.getDebugInfo();
console.log('Channels:', info.channels);
console.log('Subscribers:', info.totalSubscribers);
console.log('Total events:', info.totalEvents);
```

## Usage Examples

### Server-side Triggering

```typescript
import { pusherServer } from '@/lib/pusher';

// Trigger event on single channel
await pusherServer.trigger('task-123', 'new-message', {
  messageId: 'msg-456',
});

// Trigger event on multiple channels
await pusherServer.trigger(
  ['task-123', 'workspace-myworkspace'],
  'task-title-update',
  { taskId: '123', title: 'Updated Title' }
);
```

### Client-side Subscription

```typescript
import { getPusherClient } from '@/lib/pusher';

// Get Pusher client (mock or real based on USE_MOCKS)
const pusher = getPusherClient();

// Subscribe to channel
const channel = pusher.subscribe('task-123');

// Bind to event
channel.bind('new-message', (data) => {
  console.log('New message:', data);
});

// Cleanup
channel.unbind('new-message');
pusher.unsubscribe('task-123');
```

## Implementation Details

### Response Format Consistency

The mock implementations match the real Pusher API exactly:

**Server trigger response**:
```typescript
{ status: 200, body: {} }
```

**Client subscription**:
- Returns channel object with `bind()` and `unbind()` methods
- Event callbacks receive data in same format as real Pusher

### Mock Gating

Unlike API mock endpoints, Pusher mocks are embedded in the library itself:
- No separate `/api/mock/pusher` endpoints needed
- Mock selection happens at import time based on `USE_MOCKS`
- Both server and client automatically use mocks when enabled

### Auto-Creation

- Channels are auto-created when subscribed to
- No pre-seeding required
- Subscribers can bind events before any triggers occur

### Synchronous Delivery

Events are delivered **synchronously** in mock mode (no network delay):
- Faster tests
- Predictable behavior
- No race conditions
- Easier debugging

This differs from real Pusher (asynchronous) but is acceptable for testing.

## Benefits

1. **Zero External Dependencies**: No Pusher account needed for development
2. **Faster Development**: Synchronous event delivery, no network latency
3. **Better Testing**: Event history and state inspection
4. **Cost Savings**: No API calls to Pusher during development
5. **Offline Development**: Works without internet connection
6. **Test Isolation**: Reset state between tests
7. **Debugging**: Inspect event history and subscriber state

## Limitations

1. **Synchronous Events**: Mock delivers events synchronously (real Pusher is async)
2. **No Network Simulation**: Doesn't test connection drops, reconnection logic
3. **Single Process**: Won't work across multiple server instances (not needed for development)
4. **No Authentication**: Real Pusher supports private/presence channels with auth - mock doesn't need this

These limitations are acceptable for local development and testing. Production always uses real Pusher.

## Troubleshooting

### Events not being received

Check that:
1. `USE_MOCKS=true` is set in both server and client environments
2. Subscriber is binding to the correct event name
3. Channel name matches between trigger and subscribe
4. Subscription happens before event is triggered (or check event history)

### Type errors

The mock classes implement the same interface as real Pusher, but TypeScript may need type assertions in some cases:

```typescript
// Type assertion to match Pusher type
export const pusherServer = USE_MOCKS
  ? (new PusherServerMock() as any as Pusher)
  : new Pusher({ ... });
```

## Integration with Tests

The mock system integrates seamlessly with existing tests:

```typescript
import { pusherServer } from '@/lib/pusher';
import { pusherMockState } from '@/lib/mock/pusher-state';

test('should broadcast task update', async () => {
  // Trigger event
  await pusherServer.trigger('task-123', 'task-title-update', {
    taskId: '123',
    title: 'New Title',
  });

  // Verify event was stored
  const history = pusherMockState.getChannelHistory('task-123');
  expect(history).toHaveLength(1);
  expect(history[0].event).toBe('task-title-update');
  expect(history[0].data.title).toBe('New Title');
});
```

## Production Usage

In production (`USE_MOCKS=false`):
- Real Pusher credentials required
- Events delivered asynchronously over WebSocket
- Full Pusher feature set available
- Network resilience and reconnection handled by Pusher
