# Google Gemini API Mock Endpoints

This document describes the mock Google Gemini API endpoints available when `USE_MOCKS=true`. These endpoints simulate Gemini's image generation APIs for local development and testing without incurring API costs.

## Overview

Mock endpoints follow the same request/response format as the real Gemini API, enabling seamless development and testing of AI-powered diagram generation features.

**Service**: Google Gemini AI (gemini-2.5-flash-image model)  
**Purpose**: Generate architecture diagrams from text descriptions  
**Mock State Manager**: `mockGeminiState` (singleton)

## Configuration

Enable mock mode in your `.env.local`:

```bash
USE_MOCKS=true
# No GEMINI_API_KEY needed in mock mode
```

When `USE_MOCKS=true`:
- API calls automatically route to `http://localhost:3000/api/mock/gemini`
- API key validation accepts any key starting with `mock-gemini-key-`
- Responses return instantly with mock PNG data

## Endpoints

### POST `/api/mock/gemini/v1beta/models/{model}:generateContent`

Generates architecture diagrams from text descriptions.

**Model**: `gemini-2.5-flash-image`

**Authentication:**
- Header: `x-goog-api-key: mock-gemini-key-*` (any key starting with this prefix)

**Request Body:**
```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "text": "Convert the following architecture description into a diagram..."
        }
      ]
    }
  ],
  "generationConfig": {
    "temperature": 0.7,
    "maxOutputTokens": 2048
  }
}
```

**Response (200 OK):**
```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "inlineData": {
              "mimeType": "image/png",
              "data": "iVBORw0KGgoAAAANSUhEUg..."
            }
          }
        ],
        "role": "model"
      },
      "finishReason": "STOP",
      "safetyRatings": [
        {
          "category": "HARM_CATEGORY_HATE_SPEECH",
          "probability": "NEGLIGIBLE"
        },
        {
          "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
          "probability": "NEGLIGIBLE"
        }
      ]
    }
  ],
  "usageMetadata": {
    "promptTokenCount": 150,
    "candidatesTokenCount": 100,
    "totalTokenCount": 250
  }
}
```

**Error Responses:**

401 Unauthorized:
```json
{
  "error": {
    "code": 401,
    "message": "API key not valid. Please pass a valid API key.",
    "status": "UNAUTHENTICATED"
  }
}
```

400 Bad Request:
```json
{
  "error": {
    "code": 400,
    "message": "Invalid request: contents array required",
    "status": "INVALID_ARGUMENT"
  }
}
```

403 Forbidden (when USE_MOCKS=false):
```json
{
  "error": "Mock endpoints only available when USE_MOCKS=true"
}
```

## Mock Behavior

### Image Generation
- **Auto-generation**: Mock returns a simple 1x1 transparent PNG for all diagram requests
- **Format**: Base64-encoded PNG data in `inlineData.data` field
- **Consistency**: Same mock image returned for all requests (test determinism)

### Response Characteristics
- **No State**: Each request is independent (stateless)
- **Instant Response**: No delays simulated
- **Always Succeeds**: Mock always returns valid PNG data
- **Token Estimation**: Calculates token counts based on prompt length

### Safety Ratings
All responses include safety ratings marked as "NEGLIGIBLE":
- HARM_CATEGORY_HATE_SPEECH
- HARM_CATEGORY_DANGEROUS_CONTENT
- HARM_CATEGORY_HARASSMENT
- HARM_CATEGORY_SEXUALLY_EXPLICIT

## Integration

The mock is automatically used when:
1. `USE_MOCKS=true` in environment
2. `src/services/gemini-image.ts` calls `generateArchitectureDiagram()`
3. Frontend calls `POST /api/features/{id}/diagram/generate`

### Environment Configuration

**src/config/env.ts:**
```typescript
export const optionalEnvVars = {
  GEMINI_API_BASE_URL: USE_MOCKS
    ? `${MOCK_BASE}/api/mock/gemini`
    : "https://generativelanguage.googleapis.com",
  // ...
};

export function getGeminiApiKey(): string {
  if (USE_MOCKS) {
    return "mock-gemini-key-12345";
  }
  return process.env.GEMINI_API_KEY;
}
```

**src/config/services.ts:**
```typescript
export const serviceConfigs = {
  gemini: {
    baseURL: optionalEnvVars.GEMINI_API_BASE_URL,
    apiKey: "", // Handled by SDK
    timeout: optionalEnvVars.API_TIMEOUT,
    headers: {
      "Content-Type": "application/json",
    },
  },
};
```

### Service Layer Integration

**src/lib/gemini/client.ts:**
```typescript
export function getGeminiClient(): GoogleGenerativeAI {
  const apiKey = getGeminiApiKey();
  return new GoogleGenerativeAI(apiKey);
}
```

**src/services/gemini-image.ts:**
```typescript
import { getGeminiClient } from '@/lib/gemini/client';

export async function generateArchitectureDiagram(text: string): Promise<Buffer> {
  const genAI = getGeminiClient(); // Uses mock when USE_MOCKS=true
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image' });
  // ... rest of implementation
}
```

## Testing

### Unit Tests

```typescript
import { generateArchitectureDiagram } from '@/services/gemini-image';
import { mockGeminiState } from '@/lib/mock/gemini-state';

// In mock mode, this returns a Buffer with mock PNG
const diagramBuffer = await generateArchitectureDiagram('Frontend -> Backend -> DB');
expect(diagramBuffer).toBeInstanceOf(Buffer);
expect(diagramBuffer.length).toBeGreaterThan(0);

// Verify state tracking
const requests = mockGeminiState.getAllRequests();
expect(requests).toHaveLength(1);
expect(requests[0].prompt).toContain('Frontend -> Backend -> DB');
```

### Integration Tests

```typescript
import { mockGeminiState } from '@/lib/mock/gemini-state';

beforeEach(() => {
  mockGeminiState.reset(); // Clear state between tests
});

test('generates architecture diagram', async () => {
  const response = await fetch('/api/features/feature-123/diagram/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.success).toBe(true);
  expect(data.diagramUrl).toMatch(/^data:image\/png;base64,/);
});
```

## State Manager API

### `mockGeminiState.createRequest(prompt: string, model: string)`
Creates a new generation request with auto-generated ID and mock PNG.

**Returns**: `GenerationRequest`
```typescript
{
  id: string;           // e.g., "mock-gen-1"
  prompt: string;       // Architecture description
  model: string;        // e.g., "gemini-2.5-flash-image"
  createdAt: Date;      // Timestamp
  imageBuffer: Buffer;  // Mock PNG data
}
```

### `mockGeminiState.getRequest(id: string)`
Retrieves a generation request by ID.

**Returns**: `GenerationRequest | undefined`

### `mockGeminiState.getAllRequests()`
Returns all generation requests (for testing/debugging).

**Returns**: `GenerationRequest[]`

### `mockGeminiState.reset()`
Clears all requests and resets counter. Use in test setup.

## Environment Variables

| Variable | Description | Mock Mode | Production |
|----------|-------------|-----------|------------|
| `USE_MOCKS` | Enable mock mode | `true` | `false` |
| `GEMINI_API_KEY` | Gemini API key | Not needed | Required |
| `GEMINI_API_BASE_URL` | API base URL | Auto-set to mock | Auto-set to real API |

## Troubleshooting

### 403 Forbidden Error
- **Cause**: Mock endpoint called with `USE_MOCKS=false`
- **Solution**: Set `USE_MOCKS=true` in `.env.local`

### 401 Unauthorized Error
- **Cause**: API key doesn't start with `mock-gemini-key-`
- **Solution**: Verify `getGeminiApiKey()` returns mock key when `USE_MOCKS=true`

### Empty or Invalid Image Data
- **Cause**: Mock state manager not generating valid PNG
- **Solution**: Verify `mockGeminiState.createRequest()` returns Buffer with valid base64 PNG

## Related Files

**Configuration:**
- `src/config/env.ts` - Environment variable routing
- `src/config/services.ts` - Service configuration

**Mock Infrastructure:**
- `src/lib/mock/gemini-state.ts` - State manager
- `src/app/api/mock/gemini/v1beta/models/[modelId]/generateContent/route.ts` - Mock endpoint

**Service Layer:**
- `src/lib/gemini/client.ts` - Client wrapper
- `src/services/gemini-image.ts` - Image generation service

**Feature Endpoint:**
- `src/app/api/features/[featureId]/diagram/generate/route.ts` - Diagram generation API

**Tests:**
- `src/__tests__/unit/services/gemini-image.test.ts` - Unit tests

## Real API vs Mock Comparison

| Feature | Real Gemini API | Mock Endpoint |
|---------|----------------|---------------|
| **URL** | `generativelanguage.googleapis.com` | `localhost:3000/api/mock/gemini` |
| **API Key** | Real Gemini key | `mock-gemini-key-12345` |
| **Response Time** | 2-10 seconds | Instant |
| **Image Quality** | Actual diagram | 1x1 transparent PNG |
| **Rate Limits** | Yes (60 RPM) | No limits |
| **Cost** | Usage-based | Free |
| **Safety Filters** | Active | Simulated (always NEGLIGIBLE) |
| **Token Usage** | Actual | Estimated from length |

## Future Enhancements

Potential improvements to the mock system:

1. **Realistic Diagrams**: Use canvas/sharp to generate actual diagram images
2. **Delay Simulation**: Add configurable delays to mimic real API latency
3. **Error Scenarios**: Support mock failure modes for error testing
4. **Diagram Caching**: Cache generated diagrams by prompt hash
5. **Webhook Support**: Async diagram generation with callbacks
6. **Metrics**: Track request counts, average response times
7. **Visualization**: Web UI to view generated mock diagrams

## See Also

- [Mock System Overview](../MOCK_ENDPOINTS_SUMMARY.md)
- [Gemini Service Implementation](../src/services/gemini-image.ts)
- [Architecture Diagram Generation](../src/components/features/AITextareaSection.tsx)