# Stakgraph Ingest Endpoint Integration Tests

This directory contains comprehensive integration tests for the `/api/swarm/stakgraph/ingest` endpoint, which orchestrates code ingestion, repository management, webhook setup, and third-party service integrations for reliable code graph creation.

## Test Files Overview

### `ingest.test.ts`
Main integration test file covering:
- **Authentication & Authorization**: Session validation, user access control
- **Request Validation**: Required field checks, malformed JSON handling
- **Swarm Configuration**: Swarm existence, API key validation, repository configuration
- **Repository Operations**: Database upsert operations, status management
- **Third-Party Integration**: Stakgraph API calls, response handling
- **Webhook Setup**: GitHub webhook creation and configuration
- **Data Integrity**: Status consistency, reference ID handling
- **Error Handling**: Comprehensive error scenarios and graceful degradation
- **End-to-End Orchestration**: Complete workflow validation

### `ingest-error-scenarios.test.ts`
Dedicated error scenario testing covering:
- **Authentication Failures**: Session errors, malformed session data
- **Database Failures**: Connection issues, constraint violations, update failures
- **External Service Failures**: GitHub API issues, stakgraph communication errors
- **Encryption Service Failures**: Decryption errors, service initialization issues
- **Resource Constraints**: Memory pressure, connection pool exhaustion
- **Data Consistency**: Corrupted data handling, missing configuration edge cases

### `ingest-performance.test.ts`
Performance and load testing covering:
- **Response Time Performance**: Acceptable time limits, operation efficiency
- **Concurrent Request Handling**: Multiple simultaneous requests, mixed scenarios
- **Resource Usage Optimization**: Memory allocation, resource cleanup
- **External Service Timeouts**: Graceful timeout handling, non-blocking operations
- **Load Testing**: Sustained load performance, rapid successive requests

### `test-utilities.ts`
Comprehensive test utilities providing:
- **Mock Factories**: Swarm, repository, session, GitHub credentials, API responses
- **Scenario Setup Helpers**: Success scenarios, various failure modes
- **Assertion Helpers**: Authentication, swarm validation, API calls verification
- **Console Mock Utilities**: Error logging verification
- **Database Mock Helpers**: Success/failure database operation mocking
- **External Service Mocks**: Complete external service integration mocking

## Test Architecture

### Mock Strategy
- **External Dependencies**: All external services (GitHub, Stakgraph API, databases) are mocked
- **Service Isolation**: Each service component is independently mockable
- **Realistic Responses**: Mocks return realistic data structures and error conditions
- **State Management**: Proper mock state setup and cleanup between tests

### Test Coverage Areas

#### 1. Authentication Flow
- Session validation and user identification
- Unauthorized access prevention
- Session service error handling

#### 2. Request Processing
- JSON parsing and validation
- Required field verification
- Malformed request handling

#### 3. Swarm Management
- Swarm existence validation
- Configuration completeness checks
- API key decryption and validation

#### 4. Repository Operations
- Database upsert operations
- Status management (PENDING → SYNCED)
- Branch and URL handling

#### 5. External Integrations
- Stakgraph API communication
- GitHub credential retrieval
- Webhook service integration
- Response parsing and error handling

#### 6. Data Integrity
- Consistent state management
- Reference ID tracking
- Rollback scenarios

#### 7. Error Handling
- Graceful degradation patterns
- Error logging and user feedback
- Service isolation (webhook failures don't break main flow)

## Running the Tests

### All Integration Tests
```bash
npm run test:integration
```

### Stakgraph-Specific Tests
```bash
npm run test:integration -- src/__tests__/integration/api/swarm/stakgraph
```

### Individual Test Files
```bash
# Main integration tests
npm run test:integration -- ingest.test.ts

# Error scenarios
npm run test:integration -- ingest-error-scenarios.test.ts

# Performance tests
npm run test:integration -- ingest-performance.test.ts
```

### Watch Mode
```bash
npm run test:integration:watch
```

## Test Environment Setup

### Prerequisites
- Test database running (use `npm run test:db:start`)
- Environment variables configured for testing
- Mock external services properly configured

### Database Setup
```bash
npm run test:db:setup
```

### Database Cleanup
```bash
npm run test:db:cleanup
```

## Expected Test Results

### Success Criteria
- All authentication flows properly validated
- Database operations complete successfully
- External API integrations work correctly
- Webhook setup completes (or fails gracefully)
- Error scenarios handled appropriately
- Performance requirements met
- Data integrity maintained throughout

### Performance Benchmarks
- Complete ingestion workflow: < 5 seconds
- Authentication: < 1 second
- Database operations: < 2 seconds
- Concurrent requests: Efficient handling of 5+ simultaneous requests
- Memory usage: < 50MB increase for successful operations

## Key Test Scenarios

### Happy Path
1. Valid authentication
2. Existing swarm with proper configuration
3. Successful repository upsert
4. GitHub credentials available
5. Stakgraph API responds successfully
6. Webhook setup completes
7. Repository status updated to SYNCED
8. Swarm updated with ingest reference ID

### Critical Error Paths
1. Authentication failures (session issues)
2. Missing/invalid swarm configuration
3. Database operation failures
4. Stakgraph API communication errors
5. Webhook setup failures (should not break main flow)
6. Encryption/decryption errors
7. Resource constraint scenarios

### Edge Cases
1. Concurrent requests for same repository
2. Partial service failures
3. Timeout scenarios
4. Corrupted data recovery
5. Memory pressure situations

## Maintenance Guidelines

### Adding New Tests
1. Use provided mock factories from `test-utilities.ts`
2. Follow existing test structure and naming conventions
3. Include both success and failure scenarios
4. Add performance considerations for complex operations
5. Update this README with new test coverage

### Updating Mock Data
1. Keep mock factories in sync with actual data models
2. Update API response structures when external services change
3. Maintain realistic error scenarios
4. Version mock data appropriately

### Performance Monitoring
1. Monitor test execution times
2. Update performance benchmarks as system evolves
3. Add new performance tests for significant feature changes
4. Profile memory usage patterns

## Integration Points

### External Services
- **GitHub API**: Credential validation, webhook management
- **Stakgraph Microservice**: Code ingestion, graph creation
- **Database**: Repository and swarm management
- **Encryption Service**: API key and credential security

### Internal Components
- **Authentication Service**: User session management
- **Webhook Service**: GitHub integration
- **Swarm Management**: Configuration and status
- **Repository Management**: Database operations and status tracking

This comprehensive test suite ensures the stakgraph ingestion endpoint maintains reliability, performance, and data integrity across all orchestration scenarios.