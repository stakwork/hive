# SendMessage Chat Workflow Test Suite

This directory contains comprehensive tests for the `sendMessage` function and related chat workflow functionality.

## Test Structure

### Unit Tests

#### `/unit/chat/sendMessage.test.ts`
Comprehensive unit tests for the core `sendMessage` function covering:
- **Message Object Creation**: Tests for `createChatMessage` helper and proper message structure
- **Status Updates**: Tests for status transitions (SENDING → SENT/ERROR)
- **Error Handling**: Tests for network errors, API failures, and error toast notifications
- **UI State Integration**: Tests for `setMessages`, `setIsLoading`, and `setProjectId` state updates
- **API Integration**: Tests for proper request payload construction and response handling

#### `/unit/chat/chatMessage.test.ts`
Tests for chat message creation utilities:
- `createChatMessage` function with various configurations
- `createArtifact` function for artifact creation
- Message relationship handling (replies, tasks, websockets)
- Enum value validation (ChatRole, ChatStatus, ArtifactType)

#### `/unit/api/chat-message-endpoint.test.ts`
Tests for the `POST /api/chat/message` endpoint:
- Authentication and authorization validation
- Request payload validation
- Database message creation
- Client message format conversion
- Error handling and status codes

#### `/unit/chat/mockUtilities.test.ts`
Tests for mock utilities and response generators:
- Mock response generators (`generateFormResponse`, `generateChatFormResponse`, etc.)
- Test fixture creation helpers
- API response simulation utilities

### Integration Tests

#### `/integration/chat/sendMessage.integration.test.ts`
End-to-end integration tests for the complete sendMessage workflow:
- Full workflow integration from UI to API
- Message status transitions in real component context
- UI state management throughout the workflow
- Error scenarios with actual toast notifications
- Loading state management and race condition prevention

## Test Coverage Areas

### ✅ Message Object Creation
- Proper ChatMessage structure with all required fields
- Unique message ID generation patterns
- Artifact and attachment handling
- Context tags and metadata management

### ✅ Status Updates
- SENDING → SENT transition on successful API response
- SENDING → ERROR transition on API failure
- Status preservation during updates
- Message state consistency

### ✅ Error Handling
- Network error scenarios
- API error responses (400, 500, etc.)
- Response validation errors
- Toast notification triggers
- Error message status updates

### ✅ UI State Integration
- `setMessages` function calls and message list updates
- `setIsLoading` state management
- `setProjectId` updates on workflow responses
- `setIsChainVisible` for UI flow control
- Race condition prevention during loading

### ✅ API Integration
- Request payload construction
- HTTP method and headers validation
- Task ID and user context handling
- Artifact and attachment serialization
- Response parsing and validation

## Running Tests

### All Tests
```bash
npm run test
```

### Unit Tests Only
```bash
npm run test:unit
```

### Integration Tests Only
```bash
npm run test:integration
```

### Watch Mode
```bash
npm run test:watch
```

### Coverage Report
```bash
npm run test:coverage
```

## Mock Strategy

The tests use a comprehensive mocking strategy:

1. **External Dependencies**: NextAuth, navigation, database calls
2. **Fetch API**: Mocked globally for API call simulation
3. **React Hooks**: UI state management hooks mocked for isolation
4. **Service Functions**: External service calls (Stakwork, S3) mocked
5. **Test Fixtures**: Reusable mock data for consistent testing

## Test Utilities

### Custom Matchers
- Toast notification validation
- Message structure validation
- Status transition verification

### Mock Generators
- `generateFormResponse`: Mock form artifact responses
- `generateChatFormResponse`: Mock chat form responses
- `generateCodeResponse`: Mock code artifact responses
- `generateBugReportResponse`: Mock debug artifact responses

### Fixture Creation
- `createChatMessage`: Standard message object creation
- `createArtifact`: Standard artifact object creation
- Message relationship setup helpers

## Key Test Scenarios

### Happy Path
1. User initiates message send
2. Message created with SENDING status
3. API call succeeds
4. Status updated to SENT
5. UI state properly updated

### Error Scenarios
1. Network failure → ERROR status + toast notification
2. API error response → ERROR status + toast notification
3. Invalid response format → ERROR status + toast notification
4. Loading state race conditions → Prevented multiple sends

### Edge Cases
1. Empty message handling
2. Concurrent message sends
3. Artifact-only messages
4. Reply message handling
5. Webhook integration

## Continuous Integration

These tests are designed to run in CI/CD environments with:
- Deterministic mock responses
- No external dependencies
- Comprehensive error scenario coverage
- Performance regression detection