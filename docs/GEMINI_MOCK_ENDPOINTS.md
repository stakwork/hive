# Google Gemini AI Mock Endpoints

This document describes the mock Gemini API endpoints available when `USE_MOCKS=true`.

## Overview

Mock Gemini endpoints simulate Google's Generative AI API for image generation, allowing local development without API keys or costs.

## Configuration

Enable mock mode in `.env.local`:

```bash
USE_MOCKS=true
# GEMINI_API_KEY not required in mock mode
```

## Endpoints

### POST `/api/mock/gemini/v1/models/{model}:generateContent`

Simulates Gemini's image generation API.

**Model**: `gemini-2.0-flash-exp`

**Authentication**:
- Header: `x-goog-api-key: mock-gemini-key-*`

**Request Body**:
```json
{
  "contents": [{
    "parts": [{
      "text": "Create an architecture diagram showing: Frontend -> API -> Database"
    }]
  }]
}
```

**Response**:
```json
{
  "candidates": [{
    "content": {
      "parts": [{
        "inlineData": {
          "mimeType": "image/png",
          "data": "iVBORw0KGgoAAAANS..."
        }
      }]
    },
    "finishReason": "STOP",
    "index": 0,
    "safetyRatings": [
      {
        "category": "HARM_CATEGORY_HATE_SPEECH",
        "probability": "NEGLIGIBLE"
      },
      {
        "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
        "probability": "NEGLIGIBLE"
      },
      {
        "category": "HARM_CATEGORY_HARASSMENT",
        "probability": "NEGLIGIBLE"
      },
      {
        "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        "probability": "NEGLIGIBLE"
      }
    ]
  }],
  "promptFeedback": {
    "safetyRatings": [
      {
        "category": "HARM_CATEGORY_HATE_SPEECH",
        "probability": "NEGLIGIBLE"
      }
    ]
  },
  "usageMetadata": {
    "promptTokenCount": 25,
    "candidatesTokenCount": 256,
    "totalTokenCount": 281
  }
}
```

## Application Endpoint

### POST `/api/features/{featureId}/diagram`

Generates an architecture diagram for a feature.

**Authentication**: Required (session cookie)

**Response**: PNG image (binary)

**Errors**:
- `404` - Feature not found
- `403` - Access denied
- `400` - No architecture description
- `401` - Gemini authentication error (shouldn't happen in mock mode)
- `429` - Rate limit (mock can simulate)
- `500` - Generation failed

## Mock Behavior

- Returns a minimal valid PNG image (1x1 white pixel, 85 bytes)
- Validates API key format (`mock-gemini-key-*`)
- Records all generation requests in state
- Deterministic responses for testing
- No actual AI generation (instant response)

## Testing

```typescript
describe('Gemini Mock', () => {
  it('should generate diagram when USE_MOCKS=true', async () => {
    const response = await fetch('/api/features/feature-123/diagram', {
      method: 'POST',
      headers: { 'Cookie': sessionCookie }
    });
    
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
  });
});
```

## Architecture Flow

```
Client Request
    ↓
/api/features/{id}/diagram
    ↓
generateArchitectureDiagram() (service)
    ↓
getGeminiClient() checks USE_MOCKS
    ↓ (if true)
/api/mock/gemini/v1/models/:generateContent
    ↓
mockGeminiState.generateDiagram()
    ↓
Return minimal PNG
```

## Limitations

- Mock returns a simple 1x1 PNG (not actual diagrams)
- No AI processing (instant response)
- No rate limiting simulation (optional enhancement)
- No content safety filtering

## Error Handling

### Mock Endpoint Errors

**401 Unauthorized**:
```json
{
  "error": {
    "code": 401,
    "message": "API key not valid. Please pass a valid API key.",
    "status": "UNAUTHENTICATED"
  }
}
```

**400 Bad Request**:
```json
{
  "error": {
    "code": 400,
    "message": "Invalid request: prompt text is required",
    "status": "INVALID_ARGUMENT"
  }
}
```

**500 Internal Error**:
```json
{
  "error": {
    "code": 500,
    "message": "Internal server error",
    "status": "INTERNAL"
  }
}
```

### Application Endpoint Errors

**404 Not Found**:
```json
{
  "error": "Feature not found"
}
```

**403 Forbidden**:
```json
{
  "error": "Access denied"
}
```

**400 Bad Request**:
```json
{
  "error": "No architecture description available for this feature"
}
```

## Production Mode

When `USE_MOCKS=false`, the mock endpoint returns:

```json
{
  "error": "Mock endpoint not available in production mode"
}
```

Status: `404 Not Found`

This ensures mock endpoints are not accessible in production environments.
