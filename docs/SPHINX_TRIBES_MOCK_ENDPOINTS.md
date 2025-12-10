# Sphinx Tribes Mock Endpoints

This document describes the mock implementation of the Sphinx Tribes bounty platform API for local development and testing.

## Overview

Sphinx Tribes is a decentralized bounty platform that pays out in Bitcoin. The mock implementation enables:

- ✅ Bounty creation and management
- ✅ Bounty lookup by ID or bounty code
- ✅ User profile management
- ✅ In-memory state with auto-resource creation
- ✅ Test isolation via state reset

## Enabling Mock Mode

Set `USE_MOCKS=true` in your environment:

```bash
# .env.local
USE_MOCKS=true
```

When enabled, Sphinx Tribes API calls route to:
```
http://localhost:3000/api/mock/sphinx-tribes
```

## Current Integration

The Hive application currently integrates with Sphinx Tribes at the UI level:

1. **Bounty Creation**: When a task is assigned to the "Bounty Hunter" system assignee, Hive generates a prefilled bounty creation URL and opens it in the browser
2. **View Bounty**: Users can click to view bounties on the Sphinx Tribes website using the bounty code

The mock endpoints prepare for future backend integration where bounties could be created programmatically.

## Mock Endpoints

### Create Bounty

Creates a new bounty in the mock system.

**Endpoint**: `POST /api/mock/sphinx-tribes/bounties`

**Request Body**:
```json
{
  "title": "Fix login bug",
  "description": "User login is broken on mobile devices",
  "owner_id": "1",
  "price": 5000,
  "github_description": "https://github.com/org/repo",
  "hive_task_id": "clx123456",
  "bounty_code": "AbCdEf",
  "estimated_completion_hours": 4
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "1000",
    "title": "Fix login bug",
    "description": "User login is broken on mobile devices",
    "owner_id": "1",
    "price": 5000,
    "created": 1704067200,
    "updated": 1704067200,
    "assignee": "",
    "status": "OPEN",
    "bounty_type": "coding_task",
    "hive_task_id": "clx123456",
    "bounty_code": "AbCdEf",
    "estimated_completion_hours": 4,
    "github_description": "https://github.com/org/repo"
  }
}
```

### List Bounties

Retrieves all bounties with optional filtering.

**Endpoint**: `GET /api/mock/sphinx-tribes/bounties?status=OPEN&owner_id=1`

**Query Parameters**:
- `status` (optional): Filter by status (DRAFT, OPEN, ASSIGNED, PAID, COMPLETED)
- `owner_id` (optional): Filter by owner

**Response** (200 OK):
```json
{
  "success": true,
  "data": [
    {
      "id": "1000",
      "title": "Fix login bug",
      "status": "OPEN",
      ...
    }
  ]
}
```

### Get Bounty by ID

Retrieves a specific bounty by ID. Auto-creates if not exists.

**Endpoint**: `GET /api/mock/sphinx-tribes/bounties/:bountyId`

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "1000",
    "title": "Fix login bug",
    ...
  }
}
```

### Get Bounty by Code

Retrieves a bounty by its unique bounty code. Auto-creates if not exists.

**Endpoint**: `GET /api/mock/sphinx-tribes/bounties/code/:bountyCode`

**Example**: `GET /api/mock/sphinx-tribes/bounties/code/AbCdEf`

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "1000",
    "bounty_code": "AbCdEf",
    ...
  }
}
```

### Update Bounty

Updates an existing bounty.

**Endpoint**: `PUT /api/mock/sphinx-tribes/bounties/:bountyId`

**Request Body**:
```json
{
  "status": "ASSIGNED",
  "assignee": "hunter_pubkey_123"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "1000",
    "status": "ASSIGNED",
    "assignee": "hunter_pubkey_123",
    "updated": 1704153600,
    ...
  }
}
```

### Get User

Retrieves a user profile. Auto-creates if not exists.

**Endpoint**: `GET /api/mock/sphinx-tribes/users/:userId`

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "1",
    "pubkey": "mock_pubkey_1",
    "owner_alias": "HiveUser",
    "owner_contact_key": "mock_contact_key",
    "img": "/sphinx_icon.png"
  }
}
```

## State Management

All mock endpoints share state through `MockSphinxTribesStateManager`:

```typescript
import { mockSphinxTribesState } from "@/lib/mock/sphinx-tribes-state";

// Create bounty
mockSphinxTribesState.createBounty({ title: "Task", ... })

// Get bounty
mockSphinxTribesState.getBounty(bountyId)
mockSphinxTribesState.getBountyByCode(bountyCode)

// Update bounty
mockSphinxTribesState.updateBounty(bountyId, { status: "ASSIGNED" })

// List bounties
mockSphinxTribesState.listBounties({ status: "OPEN" })

// Reset state (for testing)
mockSphinxTribesState.reset()
```

## Mock Behavior

### Auto-Creation
- Resources are automatically created on first access if they don't exist
- Prevents 404 errors during testing
- Ensures any configuration works without pre-seeding

### Status Values
- `DRAFT`: Bounty being created
- `OPEN`: Available for hunters
- `ASSIGNED`: Claimed by a hunter
- `PAID`: Payment sent
- `COMPLETED`: Work delivered and verified

### Default Values
- Default price: 1000 satoshis
- Default owner: User ID "1"
- Status starts as "OPEN"
- Bounty type: "coding_task"

## Testing

### Example: Create and Retrieve Bounty

```bash
# 1. Create bounty
curl -X POST http://localhost:3000/api/mock/sphinx-tribes/bounties \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Bounty",
    "description": "Test description",
    "bounty_code": "TeSt01",
    "hive_task_id": "task_123"
  }'

# 2. Get by code
curl http://localhost:3000/api/mock/sphinx-tribes/bounties/code/TeSt01

# 3. Update status
curl -X PUT http://localhost:3000/api/mock/sphinx-tribes/bounties/1000 \
  -H "Content-Type: application/json" \
  -d '{"status": "ASSIGNED"}'
```

### Integration Test Example

```typescript
import { mockSphinxTribesState } from "@/lib/mock/sphinx-tribes-state";

describe("Sphinx Tribes Mock", () => {
  beforeEach(() => {
    mockSphinxTribesState.reset();
  });

  it("should create and retrieve bounty", async () => {
    const bounty = mockSphinxTribesState.createBounty({
      title: "Test Bounty",
      bounty_code: "TEST01",
    });

    const retrieved = mockSphinxTribesState.getBountyByCode("TEST01");
    expect(retrieved).toEqual(bounty);
  });

  it("should filter bounties by status", () => {
    mockSphinxTribesState.createBounty({ title: "Open", status: "OPEN" });
    mockSphinxTribesState.createBounty({ title: "Assigned", status: "ASSIGNED" });

    const openBounties = mockSphinxTribesState.listBounties({ status: "OPEN" });
    expect(openBounties).toHaveLength(1);
  });
});
```

## Troubleshooting

### Mock endpoints return 403

**Problem**: Endpoints return "Mock endpoints only available when USE_MOCKS=true"

**Solution**: Set `USE_MOCKS=true` in your `.env.local` file and restart the dev server

### Bounty not found

**Problem**: Getting null when retrieving bounty

**Solution**: Bounties are auto-created on first access. If you're still having issues, check that the bounty ID or code is correct and that mock state hasn't been reset

### State not persisting between requests

**Problem**: Created bounties disappear between requests

**Solution**: This is expected - mock state is in-memory only. State persists within the same server session but resets on restart. Use `reset()` for test isolation, not for production state management.

## Future Enhancements

When backend integration is added:

1. **Automatic Bounty Creation**: Create bounty via API when task assigned to Bounty Hunter
2. **Status Sync**: Poll bounty status and update task in Hive when completed
3. **Payment Tracking**: Record Bitcoin payments in Hive database
4. **Webhook Integration**: Receive notifications when bounty status changes

## Related Documentation

- [GitHub Mock Endpoints](./GITHUB_MOCK_ENDPOINTS.md)
- [Stakgraph Mock Endpoints](./STAKGRAPH_MOCK_ENDPOINTS.md)
- [Swarm Mock Endpoints](./SWARM_MOCK_ENDPOINTS.md)
- [Mock System Overview](./MOCK_ENDPOINTS_SUMMARY.md)
