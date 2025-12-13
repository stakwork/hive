# Pusher Mock Endpoints

This document describes the mock Pusher implementation for local development and testing.

## Overview

The Pusher mock system provides a complete, drop-in replacement for Pusher's WebSocket-based real-time messaging. When `USE_MOCKS=true`, all Pusher functionality works locally using HTTP polling instead of WebSockets, eliminating the need for external Pusher credentials during development and testing.

## Architecture

### Components

1. **Mock State Manager** (`src/lib/mock/pusher-state.ts`)
   - Singleton class managing in-memory event storage
   - Tracks subscriptions, events, and delivery state
   - Automatic cleanup of expired events and inactive subscribers

2. **Mock Client Wrapper** (`src/lib/mock/pusher-client-wrapper.ts`)
   - Mimics the Pusher.js client API
   - Uses HTTP polling instead of WebSockets
   - Compatible with existing Pusher usage patterns

3. **Pusher Library Wrapper** (`src/lib/pusher.ts`)
   - Transparently switches between real and mock Pusher
   - Server-side `pusherServer.trigger` routes to mock endpoint when mocked
   - Client-side `getPusherClient()` returns mock client when mocked

4. **Mock API Endpoints** (`src/app/api/mock/pusher/*`)
   - `/trigger` - Receives events from server
   - `/subscribe` - Registers client subscriptions
   - `/poll` - Returns new events for polling clients
   - `/unsubscribe` - Removes subscriptions
   - `/debug` - Returns current mock state

## Configuration

### Environment Variables

Add to `.env.local` or `.env.test`:

```bash
# Enable mock mode (routes all services to mock endpoints)
USE_MOCKS=true

# Base URL for mock endpoints (defaults to NEXTAUTH_URL)
NEXTAUTH_URL=http://localhost:3000
```

### Mock vs Real Pusher

When `USE_MOCKS=false`, real Pusher credentials are required:

```bash
PUSHER_APP_ID=your-app-id
PUSHER_KEY=your-key
PUSHER_SECRET=your-secret
PUSHER_CLUSTER=your-cluster

NEXT_PUBLIC_PUSHER_KEY=your-key
NEXT_PUBLIC_PUSHER_CLUSTER=your-cluster
```

When `USE_MOCKS=true`, placeholder credentials are used automatically.

## API Endpoints

### POST /api/mock/pusher/trigger

Triggers an event on a channel (server-side).

**Request:**
```json
{
  "channel": "task-123",
  "event": "new-message",
  "data": { "messageId": "msg-456" }
}
```

**Response:**
```json
{
  "event_ids": {
    "task-123": "evt_1234567890_abc123"
  }
}
```

### POST /api/mock/pusher/subscribe

Registers a client subscription to a channel.

**Request:**
```json
{
  "channel": "task-123",
  "subscriberId": "mock_key_1234567890_abc123"
}
```

**Response:**
```json
{
  "success": true,
  "channel": "task-123",
  "subscriberId": "mock_key_1234567890_abc123"
}
```

### GET /api/mock/pusher/poll

Polls for new events on a channel.

**Query Parameters:**
- `channel` - Channel name
- `subscriberId` - Subscriber ID
- `since` - ISO timestamp (optional, filters events after this time)

**Response:**
```json
{
  "events": [
    {
      "id": "evt_1234567890_abc123",
      "channel": "task-123",
      "event": "new-message",
      "data": { "messageId": "msg-456" },
      "timestamp": "2025-12-13T17:44:50.000Z"
    }
  ]
}
```

### POST /api/mock/pusher/unsubscribe

Removes a client subscription.

**Request:**
```json
{
  "subscriberId": "mock_key_1234567890_abc123"
}
```

**Response:**
```json
{
  "success": true,
  "subscriberId": "mock_key_1234567890_abc123"
}
```

### GET /api/mock/pusher/debug

Returns current mock state for debugging.

**Response:**
```json
{
  "channels": ["task-123", "workspace-my-workspace"],
  "totalEvents": 5,
  "eventsByChannel": {
    "task-123": 3,
    "workspace-my-workspace": 2
  },
  "subscribers": 2,
  "subscribersByChannel": {
    "task-123": 1,
    "workspace-my-workspace": 1
  },
  "subscriberDetails": [
    {
      "subscriberId": "mock_key_1234567890_abc123",
      "channel": "task-123",
      "lastPollTimestamp": "2025-12-13T17:44:50.000Z"
    }
  ]
}
```

## Usage

### Server-Side (Triggering Events)

```typescript
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from '@/lib/pusher';

// Trigger an event (automatically routes to mock when USE_MOCKS=true)
await pusherServer.trigger(
  getTaskChannelName(taskId),
  PUSHER_EVENTS.NEW_MESSAGE,
  messageId
);
```

### Client-Side (Subscribing to Events)

```typescript
import { getPusherClient, getTaskChannelName, PUSHER_EVENTS } from '@/lib/pusher';

// Get Pusher client (automatically returns mock when USE_MOCKS=true)
const pusher = getPusherClient();

// Subscribe to channel
const channel = pusher.subscribe(getTaskChannelName(taskId));

// Bind event handlers
channel.bind(PUSHER_EVENTS.NEW_MESSAGE, (messageId: string) => {
  console.log('New message:', messageId);
});

channel.bind('pusher:subscription_succeeded', () => {
  console.log('Subscribed successfully');
});

// Unsubscribe when done
pusher.unsubscribe(getTaskChannelName(taskId));
```

## Mock Behavior

### Event Delivery

1. Server calls `pusherServer.trigger()` → Routes to `/api/mock/pusher/trigger`
2. Event stored in `PusherMockState` with TTL (5 minutes by default)
3. Client polls `/api/mock/pusher/poll` every 1 second
4. New events returned and delivered to event callbacks
5. Delivery tracked to prevent duplicates

### Polling Interval

Default: 1 second. Can be configured:

```typescript
const pusher = new MockPusherClient('mock-key', {
  pollingInterval: 500, // Poll every 500ms
});
```

### Event TTL and Cleanup

- Events expire after 5 minutes (configurable in `PusherMockState`)
- Inactive subscribers (no poll for 10 minutes) are automatically removed
- Cleanup runs every 1 minute

### Subscription Lifecycle

1. Client calls `pusher.subscribe(channel)`
2. Mock client posts to `/api/mock/pusher/subscribe`
3. Subscription registered in mock state
4. `pusher:subscription_succeeded` event triggered
5. Polling begins automatically
6. Client calls `pusher.unsubscribe(channel)` or disconnects
7. Polling stops and subscription removed

## Testing

### Reset Mock State

```typescript
import { pusherMockState } from '@/lib/mock/pusher-state';

// Reset all events, subscriptions, and deliveries
pusherMockState.reset();
```

### Verify Events

```typescript
import { pusherMockState } from '@/lib/mock/pusher-state';

// Get all events for a channel
const events = pusherMockState.getChannelEvents('task-123');

// Get debug info
const debugInfo = pusherMockState.getDebugInfo();
console.log('Total events:', debugInfo.totalEvents);
console.log('Subscribers:', debugInfo.subscribers);
```

### Example Test

```typescript
import { pusherServer, pusherMockState } from '@/lib/pusher';

describe('Pusher Mock', () => {
  beforeEach(() => {
    pusherMockState.reset();
  });

  it('should trigger and deliver events', async () => {
    const channel = 'test-channel';
    const event = 'test-event';
    const data = { foo: 'bar' };

    // Trigger event
    await pusherServer.trigger(channel, event, data);

    // Verify event stored
    const events = pusherMockState.getChannelEvents(channel);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe(event);
    expect(events[0].data).toEqual(data);
  });
});
```

## Limitations

### Not Implemented

- **Presence channels** - Not currently used in the application
- **Private channels** - Not currently used in the application
- **Client events** - Events triggered by clients (not server)
- **Channel authentication** - All channels are public in mock mode
- **Batch triggering** - Only single event triggers supported in mock
- **WebHooks** - Pusher webhooks not simulated

### Differences from Real Pusher

- **Polling vs WebSockets**: Mock uses HTTP polling (1s interval) instead of WebSocket push
- **Latency**: Mock has slightly higher latency (~1 second) compared to real-time WebSockets
- **Event order**: Guaranteed within a channel, but cross-channel ordering not guaranteed
- **Connection state**: Mock doesn't simulate disconnections or reconnections

## Troubleshooting

### Events Not Received

1. Verify `USE_MOCKS=true` in environment
2. Check subscriber is registered: `GET /api/mock/pusher/debug`
3. Verify events are being triggered: Check `eventsByChannel` in debug endpoint
4. Check polling is active: Look for poll requests in network tab
5. Verify channel names match between trigger and subscribe

### Polling Not Working

1. Check browser console for polling errors
2. Verify `NEXTAUTH_URL` is set correctly
3. Ensure mock endpoints are accessible (not blocked by firewall/CORS)
4. Check subscriber exists: `pusherMockState.hasSubscriber(subscriberId)`

### Memory Leaks

1. Ensure channels are unsubscribed when components unmount
2. Check cleanup timer is running: Events should expire after 5 minutes
3. Monitor subscriber count in debug endpoint
4. Use `pusherMockState.reset()` in tests

### TypeScript Errors

The mock client implements a subset of the Pusher.js API. If you encounter type errors:

1. Use type assertions: `as Channel` or `as PusherClient`
2. The mock implements all commonly used methods (bind, unbind, subscribe, unsubscribe)
3. Less common methods are passed through to real Pusher (triggerBatch, authenticate, etc.)

## Performance Considerations

### Polling Overhead

- Default 1-second polling interval per channel
- Each poll is a lightweight GET request
- Consider increasing polling interval for less time-sensitive features

### Event Storage

- Events are stored in memory (Map)
- Automatic cleanup after 5 minutes
- For high-volume testing, call `pusherMockState.reset()` periodically

### Subscriber Limits

- No hard limit on subscribers
- Inactive subscribers removed after 10 minutes
- Each subscriber polls independently

## Migration from Real Pusher

No code changes required! Simply set `USE_MOCKS=true` and existing code will work with the mock system.

**Before:**
```typescript
// Uses real Pusher when USE_MOCKS=false
const pusher = getPusherClient();
const channel = pusher.subscribe('my-channel');
```

**After:**
```typescript
// Same code - automatically uses mock when USE_MOCKS=true
const pusher = getPusherClient();
const channel = pusher.subscribe('my-channel');
```

## Additional Resources

- [Pusher.js Documentation](https://pusher.com/docs/channels/using_channels/client-api/)
- [Server-side Pusher Documentation](https://pusher.com/docs/channels/library_auth_reference/rest-api/)
- [Other Mock Services](./MOCK_ENDPOINTS_SUMMARY.md)
