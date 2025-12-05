# GitHub Mock Endpoints

This document describes the mock GitHub API endpoints available when `USE_MOCKS=true`. These endpoints simulate GitHub's APIs for local development and testing without making real API calls.

## Overview

Mock endpoints follow the same request/response format as the real GitHub API, enabling seamless development and testing. All endpoints are automatically used when the `USE_MOCKS` environment variable is set to `true`.

## Configuration

Enable mock mode in your `.env.local`:

```bash
USE_MOCKS=true
```

## GitHub OAuth Flow

### POST `/api/mock/github/oauth/access_token`

Exchanges an authorization code for an access token.

**Request Body:**
```json
{
  "code": "authorization_code",
  "client_id": "your_client_id",
  "client_secret": "your_client_secret"
}
```

**Response:**
```json
{
  "access_token": "gho_mock_token_...",
  "token_type": "bearer",
  "scope": "repo,user,read:org"
}
```

## GitHub Applications API

### DELETE `/api/mock/github/applications/revoke`

Revokes a user's OAuth access token. Called when a user disconnects their GitHub account.

**Request Headers:**
- `Authorization`: Basic auth with GitHub App Client ID:Secret (base64 encoded)
- `Content-Type`: application/json

**Request Body:**
```json
{
  "access_token": "gho_xxxxxxxxxxxxx"
}
```

**Responses:**
- `204 No Content` - Token successfully revoked
- `401 Unauthorized` - Missing or invalid authentication
- `404 Not Found` - Token not found or already revoked
- `422 Unprocessable Entity` - Missing access_token in request body

**Mock Behavior:**
- Marks token as revoked in `MockGitHubState`
- Prevents revoked tokens from being used in subsequent API calls
- Idempotent - revoking an already-revoked token returns 404
- State cleared with `mockGitHubState.reset()`

**Example:**
```bash
curl -X DELETE http://localhost:3000/api/mock/github/applications/revoke \
  -H "Authorization: Basic $(echo -n 'client_id:client_secret' | base64)" \
  -H "Content-Type: application/json" \
  -d '{"access_token": "gho_mock_token_123"}'
```

## GitHub REST API

### GET `/api/mock/github/user`

Returns the authenticated user's profile information.

**Response:**
```json
{
  "login": "mockuser",
  "id": 12345,
  "node_id": "MDQ6VXNlcjEyMzQ1",
  "name": "Mock User",
  "email": "mock@example.com"
}
```

### GET `/api/mock/github/user/repos`

Returns repositories for the authenticated user.

**Response:**
```json
[
  {
    "id": 1,
    "name": "test-repo",
    "full_name": "mockuser/test-repo",
    "private": false,
    "owner": {
      "login": "mockuser"
    }
  }
]
```

### GET `/api/mock/github/repos/[owner]/[repo]`

Returns repository details.

**Response:**
```json
{
  "id": 1,
  "name": "test-repo",
  "full_name": "mockuser/test-repo",
  "description": "A test repository",
  "private": false
}
```

## State Management

All mock endpoints share state through the `MockGitHubState` singleton. This enables:

- Consistent data across related API calls
- Token validation and revocation tracking
- Test isolation via `reset()` method

### State Methods

```typescript
// Token operations
mockGitHubState.createToken(code, scope)
mockGitHubState.revokeToken(accessToken)
mockGitHubState.isTokenRevoked(accessToken)
mockGitHubState.getTokenByCode(code)

// User operations
mockGitHubState.createUser(username)
mockGitHubState.getUser(username)

// Repository operations
mockGitHubState.createRepository(owner, name)
mockGitHubState.getRepository(owner, name)

// Reset all state (for tests)
mockGitHubState.reset()
```

## Testing

The mock endpoints are designed to facilitate testing:

1. **Setup**: Enable `USE_MOCKS=true` in test environment
2. **Isolation**: Call `mockGitHubState.reset()` between tests
3. **Assertions**: Verify state changes via state manager methods
4. **Coverage**: Test edge cases without hitting rate limits

Example test:

```typescript
import { MockGitHubState } from "@/lib/mock/github-state";

describe("Token Revocation", () => {
  let mockState: MockGitHubState;

  beforeEach(() => {
    mockState = MockGitHubState.getInstance();
    mockState.reset();
  });

  it("revokes token successfully", async () => {
    const token = mockState.createToken("code", "repo");
    
    // Call revoke endpoint
    const response = await fetch("/api/mock/github/applications/revoke", {
      method: "DELETE",
      body: JSON.stringify({ access_token: token.access_token })
    });

    expect(response.status).toBe(204);
    expect(mockState.isTokenRevoked(token.access_token)).toBe(true);
  });
});
```

## Benefits

- **No External Calls**: Develop without GitHub API credentials
- **Fast & Reliable**: No network latency or rate limits
- **Deterministic**: Predictable behavior for testing
- **State Control**: Full control over mock data and scenarios
- **Pattern Consistency**: Follows same architecture as other mock services

## Related Documentation

- [Swarm Mock Endpoints](./SWARM_MOCK_ENDPOINTS.md)
- [Stakgraph Mock Endpoints](./STAKGRAPH_MOCK_ENDPOINTS.md)
- [Testing Strategy](../CLAUDE.md#testing-strategy)