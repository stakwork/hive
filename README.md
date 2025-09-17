# Run tests with coverage
npm run test:coverage
```

### Webhook Testing

The project includes comprehensive testing for Stakwork webhook functionality:

#### Test Structure
- **Unit Tests** (`src/__tests__/unit/`): Test individual functions and utilities in isolation
- **Integration Tests** (`src/__tests__/integration/`): Test API endpoints with mocked dependencies
- **End-to-End Tests** (`src/__tests__/e2e/`): Test complete webhook workflows

#### Key Test Features
- **Status Mapping**: Validates conversion from Stakwork statuses to internal WorkflowStatus enum
- **Error Handling**: Tests various failure scenarios including database errors, invalid payloads, and missing parameters
- **Pusher Broadcasting**: Verifies real-time event broadcasting with correct channel names and payloads
- **State Transitions**: Confirms proper workflow status transitions and timestamp management
- **Unknown Status Handling**: Ensures graceful handling of unrecognized status values

#### Test Utilities
- `webhook-test-helpers.ts`: Provides mocking utilities for database, Pusher, and test data creation
- Custom expect matchers for workflow statuses and Pusher events
- Comprehensive error scenario test cases

#### Running Webhook Tests
```bash
# Run webhook-specific tests
npm run test -- stakwork-webhook
npm run test -- webhook

# Run integration tests for webhooks
npm run test:integration -- webhook

# Run all webhook-related tests with coverage
npm run test:coverage -- webhook
```