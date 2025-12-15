# Anthropic Claude API Mock Endpoints

This document describes the mock Anthropic Claude API endpoints available when `USE_MOCKS=true`. These endpoints simulate Anthropic's APIs for local development and testing without incurring API costs.

## Overview

Mock endpoints follow the same request/response format as the real Anthropic API, enabling seamless development and testing of AI-powered features.

## Configuration

Enable mock mode in your `.env.local`:

```bash
USE_MOCKS=true
# No ANTHROPIC_API_KEY needed in mock mode
```

## Endpoints

### POST `/api/mock/anthropic/v1/messages`

Simulates chat completions and structured generation.

**Authentication:**
- Header: `x-api-key: mock-anthropic-key-*`

**Request Body:**
```json
{
  "model": "claude-3-5-sonnet-20241022",
  "messages": [
    {
      "role": "user",
      "content": "Write a user story for authentication"
    }
  ],
  "system": "You are a helpful assistant",
  "max_tokens": 4096,
  "temperature": 0.7,
  "stream": false
}
```

**Response (Non-Streaming):**
```json
{
  "id": "mock-req-1",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Mock response content..."
    }
  ],
  "model": "claude-3-5-sonnet-20241022",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 25,
    "output_tokens": 150
  }
}
```

**Streaming Response:**
When `stream: true`, returns Server-Sent Events (SSE) format matching Anthropic's streaming protocol.

### GET `/api/mock/anthropic/v1/models`

Lists available mock models.

**Response:**
```json
{
  "data": [
    {
      "id": "claude-3-haiku-20240307",
      "type": "model",
      "display_name": "Claude 3 Haiku"
    },
    {
      "id": "claude-3-5-sonnet-20241022",
      "type": "model",
      "display_name": "Claude 3.5 Sonnet"
    }
  ]
}
```

## Mock Behavior

### Intelligent Response Generation

The mock automatically generates contextually appropriate responses based on the prompt:

- **Feature extraction**: Returns structured feature specs
- **User stories**: Returns formatted user stories with acceptance criteria
- **Code questions**: Returns mock code assistance
- **Commit messages**: Returns conventional commit format

### State Management

- Conversations are tracked in-memory
- State persists across requests within a session
- Reset with `mockAnthropicState.reset()` for test isolation

### Auto-Creation

No pre-seeding required - the mock generates appropriate responses on-demand for any request.

## Testing

```typescript
import {
  setupAnthropicMocks,
  resetAnthropicMocks,
} from "@/__tests__/support/helpers/service-mocks/anthropic-mocks";

beforeEach(() => {
  setupAnthropicMocks({
    mockResponse: "Custom test response",
  });
});

afterEach(() => {
  resetAnthropicMocks();
});
```

## Features Using Anthropic

1. **Quick Ask** - AI-powered code chat
2. **Feature Generation** - User stories and phases
3. **Feature Extraction** - Voice to requirements
4. **Wake Word Detection** - Voice command parsing
5. **Commit Messages** - AI-generated commits
6. **Pod Management** - Goose AI integration
