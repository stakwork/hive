# Pusher Mock Endpoints

This document describes the mock implementation of the Pusher real-time messaging service, which enables local development and testing without requiring real Pusher credentials or external service access.

## Overview

Pusher provides real-time pub/sub messaging for the application's live features including chat updates, workflow status changes, task notifications, and collaborative features. The mock implementation provides:

- ✅ In-memory state management for subscriptions and channels
- ✅ Full pub/sub simulation with event broadcasting
- ✅ Connection lifecycle tracking
- ✅ Event history for debugging
- ✅ Gated by USE_MOCKS flag
- ✅ Drop-in replacement - zero component code changes needed
- ✅ Debug endpoints for state inspection and reset

## Enabling Mock Mode

Set the `USE_MOCKS` environment variable to enable all mock endpoints:

```bash
# .env.local
USE_MOCKS=true
```

When `USE_MOCKS=true`, the Pusher library automatically uses mock implementations for both server-side (`pusherServer`) and client-side (`getPusherClient()`) instances.

## Configuration

The Pusher mock configuration is managed in `src/config/env.ts`:

```typescript
export function getPusherConfig(): PusherConfig {
  if (USE_MOCKS) {
    return {
      appId: "mock-app-id",
      key: "mock-pusher-key",
      secret: "mock-pusher-secret",
      cluster: "mock-cluster",
      useTLS: true,
    };
  }
  // Real credentials...
}

export function getPusherPublicConfig(): PusherPublicConfig {
  if (USE_MOCKS) {
    return {
      key: "mock-pusher-public-key",
      cluster: "mock-cluster",
    };
  }
  // Real credentials...
}
```

## Mock Behavior

### Server-Side (pusherServer)

The mock server simulates Pusher's `trigger` method for broadcasting events:

```typescript
import { pusherServer } from '@/lib/pusher';

// Broadcast to single channel
await pusherServer.trigger('workspace-123', 'new-message', {
  message: 'Hello',
  userId: 'user-456'
});

// Broadcast to multiple channels
await pusherServer.trigger(
  ['workspace-123', 'task-789'],
  'workflow-status-update',
  { status: 'COMPLETED' }
);
```

**Mock Behavior:**
- Events are immediately broadcast to all subscribed callbacks
- No actual network requests made
- Synchronous delivery (real-time simulation)
- Tracked in event history for debugging

### Client-Side (getPusherClient)

The mock client simulates the pusher-js API for subscriptions:

```typescript
import { getPusherClient, getWorkspaceChannelName, PUSHER_EVENTS } from '@/lib/pusher';

const pusher = getPusherClient();
const channel = pusher.subscribe(getWorkspaceChannelName('my-workspace'));

channel.bind(PUSHER_EVENTS.NEW_MESSAGE, (data) => {
  console.log('New message:', data);
});

// Later: cleanup
channel.unbind(PUSHER_EVENTS.NEW_MESSAGE);
pusher.unsubscribe(getWorkspaceChannelName('my-workspace'));
```

**Mock Behavior:**
- Subscriptions tracked in in-memory state manager
- Events delivered synchronously to callbacks
- Channel lifecycle (subscribe/unsubscribe) fully simulated
- Connection state tracking

### Supported Events

All real-time events defined in `PUSHER_EVENTS` are fully supported:

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
  HIGHLIGHT_NODES: "highlight-nodes",
  FOLLOW_UP_QUESTIONS: "follow-up-questions",
} as const;
```

## Debug Endpoints

### GET `/api/mock/pusher/status`

Inspect current mock state including subscriptions, connections, and event history.

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Mock Pusher status",
  "data": {
    "subscriptions": {
      "total": 3,
      "channels": [
        {
          "channel": "workspace-123",
          "event": "new-message",
          "callbackCount": 2
        },
        {
          "channel": "task-456",
          "event": "workflow-status-update",
          "callbackCount": 1
        }
      ]
    },
    "connection": {
      "connected": true,
      "connectionCount": 1,
      "lastConnectedAt": "2025-01-15T10:30:00Z"
    },
    "recentEvents": [
      {
        "channel": "workspace-123",
        "event": "new-message",
        "timestamp": "2025-01-15T10:30:15Z"
      }
    ]
  }
}
```

**Error Response** (when `USE_MOCKS=false`):
```json
{
  "error": "Mock endpoints are disabled. Set USE_MOCKS=true to enable."
}
```
Status: `404 Not Found`

### POST `/api/mock/pusher/status`

Reset mock state (clears all subscriptions, connections, and event history).

**Request Body:**
```json
{
  "action": "reset"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Mock Pusher state reset successfully"
}
```

## State Manager API

The `MockPusherStateManager` class provides direct access to mock state for testing.

```typescript
import { mockPusherState } from '@/lib/mock/pusher-state';

// Subscribe to channel event
mockPusherState.subscribe('workspace-123', 'new-message', (data) => {
  console.log(data);
});

// Trigger event
mockPusherState.trigger('workspace-123', 'new-message', { text: 'Hello' });

// Unsubscribe
mockPusherState.unsubscribe('workspace-123', callback);

// Get subscriptions
const subscriptions = mockPusherState.getSubscriptions();

// Get connection state
const connectionState = mockPusherState.getConnectionState();

// Get event history
const history = mockPusherState.getEventHistory(100);

// Get channel subscription count
const count = mockPusherState.getChannelSubscriptionCount('workspace-123');

// Reset state (for testing)
mockPusherState.reset();
```

### Methods

**subscribe(channelName, eventName, callback)**
- Subscribe callback to channel event
- Multiple callbacks per event supported
- Returns void

**unsubscribe(channelName, callback?)**
- Remove specific callback or entire channel
- Cleans up empty event sets automatically
- Returns void

**trigger(channelName, eventName, data)**
- Broadcast event to all subscribed callbacks
- Returns number of callbacks invoked
- Tracks event in history

**connect()**
- Simulate connection establishment
- Increments connection count
- Returns void

**disconnect()**
- Simulate connection termination
- Updates last disconnected timestamp
- Returns void

**getConnectionState()**
- Returns current connection state object
- Properties: connected, connectionCount, lastConnectedAt, lastDisconnectedAt

**getSubscriptions()**
- Returns array of all active subscriptions
- Each entry: channelName, eventName, callbackCount

**getEventHistory(limit = 100)**
- Returns recent triggered events
- Includes: channelName, eventName, data, timestamp
- Limited to last N events

**getChannelSubscriptionCount(channelName)**
- Returns total callback count for channel
- Sums across all events

**reset()**
- Clears all subscriptions, connections, and event history
- Essential for test isolation

## Testing

### Manual Testing

```bash
# 1. Set mock mode
echo "USE_MOCKS=true" >> .env.local

# 2. Start development server
npm run dev

# 3. Test status endpoint
curl http://localhost:3000/api/mock/pusher/status

# 4. Reset state
curl -X POST http://localhost:3000/api/mock/pusher/status \
  -H "Content-Type: application/json" \
  -d '{"action":"reset"}'
```

### Automated Testing

#### Unit Tests

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPusherState } from '@/lib/mock/pusher-state';

describe('Pusher Mock', () => {
  beforeEach(() => {
    mockPusherState.reset();
  });

  it('should broadcast events to subscribers', () => {
    const callback = vi.fn();
    
    mockPusherState.subscribe('workspace-123', 'new-message', callback);
    mockPusherState.trigger('workspace-123', 'new-message', { text: 'Hello' });
    
    expect(callback).toHaveBeenCalledWith({ text: 'Hello' });
  });

  it('should support multiple subscribers', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    
    mockPusherState.subscribe('workspace-123', 'new-message', callback1);
    mockPusherState.subscribe('workspace-123', 'new-message', callback2);
    
    const invoked = mockPusherState.trigger('workspace-123', 'new-message', {});
    
    expect(invoked).toBe(2);
    expect(callback1).toHaveBeenCalled();
    expect(callback2).toHaveBeenCalled();
  });
});
```

#### Integration Tests

```typescript
import { getPusherClient, getWorkspaceChannelName } from '@/lib/pusher';

describe('Pusher Client Mock', () => {
  beforeEach(() => {
    process.env.USE_MOCKS = 'true';
  });

  it('should subscribe and receive events', () => {
    const pusher = getPusherClient();
    const channel = pusher.subscribe(getWorkspaceChannelName('test'));
    
    const callback = vi.fn();
    channel.bind('new-message', callback);
    
    // Simulate server trigger
    mockPusherState.trigger('workspace-test', 'new-message', { test: true });
    
    expect(callback).toHaveBeenCalledWith({ test: true });
    
    // Cleanup
    channel.unbind('new-message', callback);
    pusher.unsubscribe(getWorkspaceChannelName('test'));
  });
});
```

## Environment Variables

Required environment variables for mock mode:

```bash
# Enable mock mode
USE_MOCKS=true

# Base URL for application (used as MOCK_BASE)
NEXTAUTH_URL=http://localhost:3000

# Optional: Pusher credentials (ignored when USE_MOCKS=true)
# PUSHER_APP_ID=
# PUSHER_KEY=
# PUSHER_SECRET=
# PUSHER_CLUSTER=
# NEXT_PUBLIC_PUSHER_KEY=
# NEXT_PUBLIC_PUSHER_CLUSTER=
```

## Troubleshooting

### "Pusher environment variables are not configured" error

**Cause**: Mock credentials not being returned properly

**Solution**: 
```bash
# Verify USE_MOCKS is set
echo $USE_MOCKS  # Should be "true"

# Check config functions
# In src/config/env.ts, verify getPusherConfig() returns mock credentials
```

### Events not received by subscribers

**Possible causes**:
1. Channel name mismatch
2. Event name mismatch
3. Subscription not established before trigger
4. Callback unbound before trigger

**Solution**: 
```typescript
// Check subscriptions
const subs = mockPusherState.getSubscriptions();
console.log('Active subscriptions:', subs);

// Verify channel names match exactly
const channelName = getWorkspaceChannelName('my-workspace');
console.log('Channel name:', channelName);  // Should be 'workspace-my-workspace'
```

### State persists between tests

**Cause**: Missing `reset()` in test setup

**Solution**: 
```typescript
import { beforeEach } from 'vitest';
import { mockPusherState } from '@/lib/mock/pusher-state';

beforeEach(() => {
  mockPusherState.reset();
});
```

### Debug endpoint returns 404

**Cause**: `USE_MOCKS` not set to `true`

**Solution**: 
```bash
# Add to .env.local
USE_MOCKS=true

# Restart development server
npm run dev
```

### Real Pusher library being used instead of mock

**Cause**: Direct `process.env` access instead of centralized config

**Solution**: 
```typescript
// WRONG:
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  // ...
});

// CORRECT:
import { pusherServer, getPusherClient } from '@/lib/pusher';
// These automatically use mock when USE_MOCKS=true
```

## Differences from Production

| Feature | Mock Mode | Production |
|---------|-----------|------------|
| Credentials | Mock values | Real Pusher credentials |
| Network | No external requests | HTTPS to pusher.com |
| Latency | Instant (synchronous) | Network dependent |
| Broadcasting | In-memory callbacks | Pusher infrastructure |
| Persistence | Single-process only | Multi-process via Pusher |
| Debug Endpoints | Available | Not available |
| Event History | Tracked | Not tracked |
| Connection State | Simulated | Real WebSocket |

## Limitations

### Single-Process Only

The mock operates in-memory within a single Node.js process. Multi-process deployments (e.g., serverless functions) won't share state between instances.

**Impact**: Not suitable for testing distributed real-time features in production-like environment

**Workaround**: Use real Pusher for multi-process testing scenarios

### Synchronous Event Delivery

Events are delivered synchronously to callbacks, whereas real Pusher uses asynchronous WebSocket delivery.

**Impact**: Timing-sensitive code may behave differently

**Workaround**: Wrap triggers in `setTimeout` if async behavior is critical

### No Network Failure Simulation

The mock always succeeds. No simulation of network errors, connection drops, or rate limiting.

**Impact**: Error handling code paths not exercised

**Workaround**: Use real Pusher for error scenario testing

### No Authentication/Authorization

Mock doesn't validate channel names, enforce private channel restrictions, or check authentication.

**Impact**: Security-related tests won't catch authorization bugs

**Workaround**: Use real Pusher for security testing

## Related Files

**Configuration:**
- `src/config/env.ts` - getPusherConfig(), getPusherPublicConfig()
- `src/config/services.ts` - Service configuration (Pusher doesn't use this)

**Mock Infrastructure:**
- `src/lib/mock/pusher-state.ts` - State manager
- `src/app/api/mock/pusher/status/route.ts` - Debug endpoints

**Pusher Library:**
- `src/lib/pusher.ts` - Client wrapper with mock routing

**Components Using Pusher:**
- `src/hooks/usePusherConnection.ts` - Connection lifecycle hook
- `src/hooks/useWebhookHighlights.ts` - Node highlighting via Pusher
- `src/services/janitor.ts` - Janitor recommendation broadcasts
- `src/services/stakwork-run.ts` - Stakwork run status updates

**Tests:**
- `src/__tests__/unit/lib/mock/pusher-state.test.ts` - State manager tests
- `src/__tests__/unit/lib/pusher.test.ts` - Pusher library tests

## Migration Path

The mock system supports gradual migration:

**Current State (Real Pusher)**:
- Requires Pusher credentials
- External network dependency
- Production-like behavior

**New (Mock Mode)**:
- No credentials needed
- Routes to in-memory mock
- Simulates real-time behavior locally

Both modes can coexist based on `USE_MOCKS` flag.

## Future Enhancements

Potential improvements to the mock system:

- [ ] Add network latency simulation with configurable delays
- [ ] Implement connection failure scenarios for error testing
- [ ] Add rate limiting simulation
- [ ] Support private/presence channel authorization
- [ ] Add Pusher webhook simulation for server events
- [ ] Implement multi-process state sharing via Redis
- [ ] Add metrics tracking (message rates, subscription counts)
- [ ] Support Pusher channel existence queries
- [ ] Implement user authentication simulation
- [ ] Add visual debugger UI for real-time event flow

## See Also

- [Mock System Overview](../MOCK_ENDPOINTS_SUMMARY.md)
- [Pusher Library Implementation](../src/lib/pusher.ts)
- [State Manager Implementation](../src/lib/mock/pusher-state.ts)
- [Real-time Connection Hook](../src/hooks/usePusherConnection.ts)