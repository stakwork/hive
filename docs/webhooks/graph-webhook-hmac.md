# Graph Webhook HMAC Signature Verification

## Overview

The Graph webhook endpoint (`/api/graph/webhook`) uses HMAC-SHA256 signature verification to ensure authenticity and integrity of incoming requests. This replaces the previous simple API key authentication with cryptographic signature validation.

## Architecture

### Security Model

- **Per-Entity Secrets**: Each swarm has its own encrypted webhook secret stored in the database
- **Field-Level Encryption**: Secrets are encrypted at rest using AES-256-GCM
- **Timing-Safe Comparison**: Uses constant-time comparison to prevent timing attacks
- **HMAC-SHA256**: Industry-standard message authentication code algorithm

### Components

1. **GraphWebhookService** (`src/services/swarm/GraphWebhookService.ts`)
   - `lookupAndVerifySwarm()`: Complete signature verification flow
   - `generateWebhookSecret()`: Generate cryptographically secure secrets

2. **Route Handler** (`src/app/api/graph/webhook/route.ts`)
   - Extracts signature header and raw body
   - Delegates verification to service layer
   - Processes verified webhook events

3. **Database Schema** (`prisma/schema.prisma`)
   - `Swarm.graphWebhookSecret`: Encrypted webhook secret field

## Implementation Pattern

The implementation follows the proven 5-step verification pattern:

### Step 1: Extract Headers & Raw Body
```typescript
const signature = request.headers.get('x-signature');
const rawBody = await request.text(); // BEFORE JSON parsing
```

**Critical**: HMAC must be computed on the exact raw bytes, not parsed JSON.

### Step 2: Lookup Entity
```typescript
const swarm = await db.swarm.findUnique({
  where: { id: swarmId }
});
```

### Step 3: Decrypt Webhook Secret
```typescript
const secret = encryptionService.decryptField(
  'graphWebhookSecret',
  swarm.graphWebhookSecret
);
```

### Step 4: Compute Expected HMAC
```typescript
const expectedDigest = computeHmacSha256Hex(secret, rawBody);
const expected = `sha256=${expectedDigest}`;
```

### Step 5: Timing-Safe Comparison
```typescript
if (!timingSafeEqual(expected, signature)) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

## Request Format

### Headers
```
POST /api/graph/webhook
Content-Type: application/json
x-signature: sha256={hmac_hex_digest}
```

### Payload
```json
{
  "swarmId": "uuid-of-swarm",
  "testFilePath": "path/to/test.spec.ts",
  "status": "success|failed|running",
  "error": "Optional error message",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

## Generating Signatures

To generate a valid signature for a webhook request:

```typescript
import { computeHmacSha256Hex } from '@/lib/encryption';

const payload = {
  swarmId: 'your-swarm-id',
  testFilePath: 'src/__tests__/e2e/specs/test.spec.ts',
  status: 'success'
};

const body = JSON.stringify(payload);
const digest = computeHmacSha256Hex(webhookSecret, body);
const signature = `sha256=${digest}`;

// Send in x-signature header
```

## Setting Up Webhook Secrets

### For New Swarms
```typescript
const webhookService = new GraphWebhookService();
const encryptedSecret = webhookService.generateWebhookSecret();

await db.swarm.create({
  data: {
    // ... other fields
    graphWebhookSecret: encryptedSecret
  }
});
```

### For Existing Swarms
```typescript
const webhookService = new GraphWebhookService();
const encryptedSecret = webhookService.generateWebhookSecret();

await db.swarm.update({
  where: { id: swarmId },
  data: {
    graphWebhookSecret: encryptedSecret
  }
});

// Decrypt and send plain secret to external Graph service
const plainSecret = encryptionService.decryptField(
  'graphWebhookSecret',
  encryptedSecret
);
```

## Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Missing signature header | Request lacks `x-signature` header |
| 400 | Invalid JSON payload | Request body is not valid JSON |
| 400 | Missing swarmId in payload | Payload lacks required `swarmId` field |
| 401 | Unauthorized | Signature verification failed |
| 500 | Internal server error | Unexpected server error |

## Security Considerations

### Timing Attack Prevention
- All signature comparisons use `timingSafeEqual()` for constant-time comparison
- Prevents attackers from inferring secret information through timing differences

### Secret Storage
- Webhook secrets are encrypted at rest using field-level encryption
- Uses AES-256-GCM with authenticated encryption
- Supports key rotation via `TOKEN_ENCRYPTION_KEY_ID`

### Request Integrity
- HMAC covers the entire raw request body
- Any tampering with payload invalidates signature
- Protects against man-in-the-middle attacks

### Secret Generation
- Uses `crypto.randomBytes(32)` for cryptographically secure random generation
- 32 bytes = 256 bits of entropy
- Encoded as 64-character hexadecimal string

## Testing

### Test Fixtures
```typescript
import {
  computeValidGraphWebhookSignature,
  createGraphWebhookRequest,
  createTestStatusPayload
} from '@/__tests__/support/fixtures/graph-webhook';

const payload = createTestStatusPayload(swarmId, testFilePath, 'success');
const request = createGraphWebhookRequest(payload, plainSecret);
```

### Integration Tests
- Full signature verification flow
- Database lookup and secret decryption
- Timing attack protection
- Error handling scenarios
- Task status update logic

See `src/__tests__/integration/api/graph-webhook.test.ts` for complete test suite.

## Migration from API Key Authentication

### Backward Compatibility
During transition period, the endpoint can support both authentication methods:

```typescript
// Check for HMAC signature first
const signature = request.headers.get('x-signature');
if (signature) {
  // Use HMAC verification
  const swarm = await webhookService.lookupAndVerifySwarm(...);
} else {
  // Fall back to API key (deprecated)
  const apiKey = request.headers.get('x-api-key');
  if (apiKey === process.env.GRAPH_WEBHOOK_API_KEY) {
    // Process webhook
  }
}
```

### Migration Steps
1. Deploy HMAC implementation to production
2. Generate webhook secrets for all existing swarms
3. Update external Graph service configuration with new secrets
4. Monitor logs for API key usage
5. Remove API key fallback once migration complete
6. Remove `GRAPH_WEBHOOK_API_KEY` environment variable

## References

- **Reference Implementation**: `src/services/swarm/StakgraphWebhookService.ts`
- **Crypto Utilities**: `src/lib/encryption/index.ts`
- **GitHub Webhook**: `src/app/api/github/webhook/route.ts`
- **Test Patterns**: `src/__tests__/integration/api/github-webhook.test.ts`
