# LiveKit Mock Endpoints

This document describes the mock implementation of the LiveKit Video Call Service, which enables local development and testing without requiring real LiveKit credentials or external service access.

## Overview

LiveKit provides video call infrastructure for workspace collaboration. In this application, we construct call URLs using a base URL pattern and don't directly interact with LiveKit APIs during normal operation.

The mock implementation provides:

- ✅ Stateless operation (no state management needed)
- ✅ URL pattern matching
- ✅ Request logging for debugging
- ✅ Gated by USE_MOCKS flag
- ✅ Zero external dependencies
- ✅ Works without LiveKit credentials

## Enabling Mock Mode

Set the `USE_MOCKS` environment variable to enable all mock endpoints:

```bash
# .env.local
USE_MOCKS=true
```

When `USE_MOCKS=true`, the LiveKit URL automatically resolves to:
```
http://localhost:3000/api/mock/livekit/
```

## Configuration

The LiveKit URL is configured in `src/config/env.ts`:

```typescript
export const optionalEnvVars = {
  LIVEKIT_CALL_BASE_URL: USE_MOCKS
    ? `/api/mock/livekit/`
    : process.env.LIVEKIT_CALL_BASE_URL || "https://call.livekit.io/",
  // ... other config
}
```

## URL Pattern

**Real**: `https://call.livekit.io/{swarmName}.sphinx.chat-.{timestamp}`  
**Mock**: `http://localhost:3000/api/mock/livekit/{swarmName}.sphinx.chat-.{timestamp}`

The application generates call links via:
```
POST /api/workspaces/{slug}/calls/generate-link
```

This endpoint constructs the full URL using the configured base URL and returns:
```json
{
  "url": "http://localhost:3000/api/mock/livekit/my-swarm.sphinx.chat-.1234567890"
}
```

## Mock Endpoint

### GET/POST `/api/mock/livekit/[...path]`

Catch-all endpoint that accepts any path and returns success.

**Response**:
```json
{
  "success": true,
  "message": "Mock LiveKit call endpoint",
  "callPath": "{swarmName}.sphinx.chat-.{timestamp}",
  "note": "In production, this would serve the LiveKit call interface"
}
```

**Error Response** (when `USE_MOCKS=false`):
```json
{
  "error": "Mock endpoints are disabled"
}
```
Status: `404 Not Found`

## Usage in Application

The application generates call links through the workspace API:

### Generate Call Link

**Endpoint**: `POST /api/workspaces/{slug}/calls/generate-link`

**Requirements**:
- User must be authenticated
- Workspace must exist and not be deleted
- Workspace must have an active swarm with a valid name
- User must be workspace owner OR active member

**Response** (200 OK):
```json
{
  "url": "http://localhost:3000/api/mock/livekit/my-swarm.sphinx.chat-.1705318800"
}
```

**Error Responses**:
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not authorized to access workspace
- `404 Not Found` - Workspace not found
- `400 Bad Request` - Workspace deleted or no active swarm

## Testing

### Manual Testing

```bash
# 1. Set mock mode
echo "USE_MOCKS=true" >> .env.local

# 2. Start development server
npm run dev

# 3. Generate a call link (replace with your workspace slug and auth token)
curl -X POST http://localhost:3000/api/workspaces/my-workspace/calls/generate-link \
  -H "Cookie: next-auth.session-token=your-session-token" \
  -H "Content-Type: application/json"

# Response:
# { "url": "http://localhost:3000/api/mock/livekit/my-swarm.sphinx.chat-.1705318800" }

# 4. Access the mock call URL
curl http://localhost:3000/api/mock/livekit/my-swarm.sphinx.chat-.1705318800

# Response:
# {
#   "success": true,
#   "message": "Mock LiveKit call endpoint",
#   "callPath": "my-swarm.sphinx.chat-.1705318800",
#   "note": "In production, this would serve the LiveKit call interface"
# }
```

### Automated Testing

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('LiveKit Mock', () => {
  beforeEach(() => {
    process.env.USE_MOCKS = 'true';
  });

  it('should generate call link with mock base URL', async () => {
    const response = await fetch(
      `/api/workspaces/${workspace.slug}/calls/generate-link`,
      {
        method: 'POST',
        headers: { /* auth headers */ }
      }
    );

    const data = await response.json();
    expect(data.url).toContain('/api/mock/livekit/');
    expect(data.url).toContain(workspace.swarm.name);
  });

  it('should return success when accessing mock call URL', async () => {
    const callUrl = 'http://localhost:3000/api/mock/livekit/test-swarm.sphinx.chat-.123456';
    const response = await fetch(callUrl);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.callPath).toContain('test-swarm');
  });

  it('should return 404 when USE_MOCKS is false', async () => {
    process.env.USE_MOCKS = 'false';
    
    const response = await fetch('http://localhost:3000/api/mock/livekit/test');
    
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toContain('Mock endpoints are disabled');
  });
});
```

## State Management

**Not Required** - LiveKit mock is stateless because:
- No resources are created or tracked
- URLs are generated on-demand
- No webhooks or callbacks to simulate
- No complex lifecycle to manage

If future requirements include tracking active calls or simulating call events, a state manager could be added following the pattern in `src/lib/mock/swarm-state.ts`.

## Environment Variables

Required environment variables for mock mode:

```bash
# Enable mock mode
USE_MOCKS=true

# Base URL for application
NEXTAUTH_URL=http://localhost:3000

# Optional: LiveKit base URL (only used when USE_MOCKS=false)
# LIVEKIT_CALL_BASE_URL=https://call.livekit.io/
```

## Troubleshooting

### "Mock endpoints are disabled" error

**Cause**: `USE_MOCKS` is not set to `true`

**Solution**: 
```bash
# Add to .env.local
USE_MOCKS=true
```

### Call generation returns 404

**Possible causes**:
1. Workspace doesn't exist
2. Workspace is deleted
3. No active swarm linked to workspace
4. Swarm name is empty/null
5. User not authorized

**Solution**: Verify workspace setup:
```bash
# Check workspace has active swarm
npx prisma studio
# Navigate to Workspace → verify swarm exists and status is ACTIVE
```

### Generated URL returns 404

**Cause**: Mock endpoint not being reached

**Solution**: 
1. Verify `USE_MOCKS=true` in environment
2. Check `src/config/env.ts` has `LIVEKIT_CALL_BASE_URL` entry
3. Ensure URL starts with `http://localhost:3000/api/mock/livekit/`
4. Check application logs for "[Mock LiveKit]" messages

### URL doesn't match expected pattern

**Cause**: Direct `process.env` access instead of centralized config

**Solution**: 
```typescript
// WRONG:
const baseUrl = process.env.LIVEKIT_CALL_BASE_URL;

// CORRECT:
import { optionalEnvVars } from "@/config/env";
const baseUrl = optionalEnvVars.LIVEKIT_CALL_BASE_URL;
```

## Differences from Production

| Feature | Mock Mode | Production |
|---------|-----------|------------|
| Base URL | `localhost:3000/api/mock/livekit/` | `call.livekit.io/` |
| Response | JSON success message | LiveKit call UI (HTML/WebRTC) |
| Authentication | No LiveKit auth needed | Requires LiveKit credentials |
| Availability | Local development only | Global CDN |
| Latency | Instant (local) | Network dependent |
| Features | URL validation only | Full video call functionality |

## Migration Path

The mock system supports gradual migration:

**Current (if using fake mode)**:
- In-memory fake data, no API calls

**New (Mock Mode)**:
- Routes to `/api/mock/*` endpoints
- Simulates real API behavior
- Validates request structure

Both modes can coexist during migration.

## Related Files

- `src/config/env.ts` - Environment configuration with mock URL resolution
- `src/app/api/workspaces/[slug]/calls/generate-link/route.ts` - Call link generation endpoint
- `src/app/api/mock/livekit/[...path]/route.ts` - Mock endpoint implementation
- `env.example` - Environment variable documentation
- `docs/GITHUB_MOCK_ENDPOINTS.md` - Similar mock documentation
- `docs/SWARM_MOCK_ENDPOINTS.md` - Similar mock documentation
- `docs/STAKGRAPH_MOCK_ENDPOINTS.md` - Similar mock documentation

## Future Enhancements

Potential improvements to the mock system:

- [ ] Add call recording simulation
- [ ] Implement webhook callbacks for call events
- [ ] Add participant tracking
- [ ] Support call duration limits
- [ ] Implement call quality metrics
- [ ] Add WebRTC signaling simulation
- [ ] Support multiple concurrent calls
- [ ] Add call history tracking

## Notes

- **Simplest Mock**: LiveKit is ideal as a first mock because it only involves URL construction, no API calls
- **Zero Dependencies**: No LiveKit SDK or credentials required
- **Pattern Consistency**: Follows exact same pattern as GitHub, Stakwork, Pool Manager, and Swarm mocks
- **Stateless Design**: No state management needed - URLs generated on-demand
- **Future-Proof**: Easy to extend with webhooks or call tracking if needed