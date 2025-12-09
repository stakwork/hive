# Google Gemini API Mock Endpoints

This document describes the mock Google Gemini API endpoints available when `USE_MOCKS=true`. These endpoints simulate Gemini's image generation for architecture diagrams without making real API calls.

## Overview

Mock endpoints follow the same request/response format as the real Google Gemini API, enabling seamless development and testing.

## Configuration

Enable mock mode in your `.env.local`:

```bash
USE_MOCKS=true
# GEMINI_API_KEY not required in mock mode
```

## Endpoint

### POST `/api/mock/gemini/v1/generate`

Generates architecture diagram images from text descriptions.

**Authentication:**
- Header: `x-api-key: mock-gemini-key-*`

**Request Body:**
```json
{
  "model": "gemini-2.5-flash-image",
  "prompt": "Convert the following architecture description into a clear, professional system architecture diagram..."
}
```

**Response:**
```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "inlineData": {
              "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCA...",
              "mimeType": "image/png"
            }
          }
        ]
      }
    }
  ]
}
```

## Mock Behavior

### Auto-Creation
- Generates valid PNG images on demand
- No pre-seeding required
- Returns deterministic placeholder images

### State Management
- Tracks all generation requests
- In-memory storage of generated images
- Reset with `geminiMockState.reset()`

### Response Format
- Matches Google Gemini API structure exactly
- Base64-encoded PNG data
- Valid image format for browser rendering

## Testing

```typescript
import { geminiMockState } from '@/lib/mock/gemini-state';

beforeEach(() => {
  geminiMockState.reset();
});

test('generates architecture diagram', async () => {
  const result = await generateArchitectureDiagram('Frontend -> Backend -> DB');
  expect(result).toBeInstanceOf(Buffer);
  expect(result.length).toBeGreaterThan(0);
});
```

## Features Using Gemini

1. **Architecture Diagram Generation** - Convert text to visual diagrams
2. **Feature Architecture Visualization** - Generate system architecture images
3. **Documentation Enhancement** - Auto-generate technical diagrams

## Future Enhancements

The mock currently returns a minimal valid PNG. Future improvements could include:

1. **Dynamic Diagram Generation**: Use `node-canvas` to generate actual boxes and arrows
2. **Component Detection**: Parse prompt to identify components and relationships
3. **Multiple Diagram Styles**: Support different architectural patterns
4. **Color Coding**: Different colors for different component types