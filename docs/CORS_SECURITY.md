# CORS Security Implementation

## Overview

This application implements a **dual-layer security model** that combines:

1. **Zero-Trust Cryptographic Verification** (Primary Security)
2. **Origin-Based CORS Policy** (Secondary/Optional Security)

This document explains when and how to use CORS configuration.

---

## Current Security Architecture (Without CORS)

### Default Protection Mechanisms

By default, the application uses **same-origin policy** enforced by Next.js and modern browsers:

✅ **Blocked by Default**: Cross-origin browser requests are rejected unless explicitly allowed  
✅ **Webhook Security**: Server-to-server webhooks verify HMAC-SHA256 cryptographic signatures  
✅ **User Authentication**: Protected routes require valid NextAuth sessions  
✅ **Middleware Enforcement**: Route-level access control before request processing

### When You DON'T Need CORS

You do NOT need to enable CORS if:

- Your frontend and API are served from the same domain (e.g., `example.com`)
- You only have server-to-server webhook integrations (GitHub, Stakwork, etc.)
- All API calls come from the same Next.js application

**Recommendation**: Keep CORS disabled (`ENABLE_CORS=false`) unless you have a specific cross-origin requirement.

---

## When to Enable CORS

Enable CORS only if you have:

1. **Separate Frontend Domain**: Frontend at `app.example.com` calling API at `api.example.com`
2. **Multiple Client Applications**: Different subdomains or domains accessing the same API
3. **Third-Party Browser Extensions**: Browser extensions making authenticated requests
4. **Mobile App Web Views**: WebView components in mobile apps accessing the API

---

## Configuration

### Environment Variables

Add these variables to your `.env.local` file:

```bash
# Enable CORS headers for trusted domains
ENABLE_CORS=true

# Comma-separated list of trusted origins (MUST include protocol and port if non-standard)
TRUSTED_DOMAINS=https://app.example.com,https://dashboard.example.com,http://localhost:3000
```

### Important Notes

- **Protocol Required**: Each domain MUST include `http://` or `https://`
- **Port Matching**: `http://localhost:3000` is different from `http://localhost:8080`
- **No Wildcards**: Exact domain matching only (e.g., `https://*.example.com` is NOT supported)
- **Case Sensitive**: `https://app.example.com` ≠ `https://APP.example.com`
- **Trailing Slashes**: Normalized automatically (both `https://app.example.com` and `https://app.example.com/` work)

---

## How CORS Works with Existing Security

### Request Flow (CORS Enabled)

```
1. Browser sends OPTIONS preflight request
   ↓
2. Middleware checks origin against TRUSTED_DOMAINS
   ↓
3. If trusted: Return 204 with CORS headers
   If untrusted: Continue to authentication (will fail)
   ↓
4. Browser sends actual request (GET, POST, etc.)
   ↓
5. Middleware validates session/signature (existing security)
   ↓
6. If valid: Add CORS headers to response
   If invalid: Return 401/403 (no CORS headers)
```

### CORS Headers Added

For trusted origins, the following headers are added to responses:

```
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With
Access-Control-Max-Age: 86400
Access-Control-Allow-Credentials: true
```

### Routes Excluded from CORS

The following routes **never** receive CORS headers (server-to-server only):

- `/api/github/webhook` - GitHub webhook events
- `/api/stakwork/webhook` - Stakwork integrations
- `/api/webhook/stakwork/*` - Stakwork response webhooks
- `/api/janitors/webhook` - Janitor system webhooks
- `/api/swarm/stakgraph/webhook` - Stakgraph sync callbacks
- `/api/chat/response` - Chat service responses

These routes rely on cryptographic signature verification, not origin validation.

---

## Security Guarantees

### What CORS Protects Against

✅ **Browser-Based CSRF**: Prevents malicious websites from making requests using user's credentials  
✅ **Unauthorized Origins**: Only whitelisted domains can make cross-origin requests  
✅ **Data Leakage**: Blocks untrusted sites from reading API responses in browser context

### What CORS Does NOT Protect Against

❌ **Server-Side Attacks**: Origin header can be spoofed in server-to-server requests  
❌ **Token Theft**: If an attacker steals authentication tokens, CORS won't stop them  
❌ **Replay Attacks**: CORS doesn't prevent reuse of valid requests

**This is why we maintain cryptographic verification for webhooks** - CORS is only effective for browser-based requests.

---

## Testing CORS Configuration

### Manual Testing with curl

```bash
# Test preflight request
curl -X OPTIONS https://api.example.com/api/workspaces \
  -H "Origin: https://app.example.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -v

# Expected: 204 No Content with CORS headers

# Test actual request
curl -X GET https://api.example.com/api/workspaces \
  -H "Origin: https://app.example.com" \
  -H "Cookie: next-auth.session-token=your-token" \
  -v

# Expected: 200 OK with CORS headers
```

### Browser Testing

1. Open browser console on `https://app.example.com`
2. Run:
```javascript
fetch('https://api.example.com/api/workspaces', {
  method: 'GET',
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json'
  }
})
.then(r => r.json())
.then(console.log)
.catch(console.error);
```

3. Check Network tab:
   - Preflight OPTIONS request should return 204
   - Actual GET request should return data
   - Both should have `Access-Control-Allow-Origin` header

### Automated Tests

Run the included test suite:

```bash
# Unit tests for CORS utilities
npm run test:unit -- src/__tests__/unit/lib/cors/cors-utils.test.ts

# Integration tests for middleware behavior
npm run test:integration -- src/__tests__/integration/middleware/cors-integration.test.ts
```

---

## Troubleshooting

### "No 'Access-Control-Allow-Origin' header present"

**Causes**:
1. CORS not enabled: Check `ENABLE_CORS=true` in `.env.local`
2. Origin not trusted: Verify origin is in `TRUSTED_DOMAINS`
3. Webhook route: These routes intentionally exclude CORS headers

**Solutions**:
- Verify environment variables are loaded: `console.log(process.env.ENABLE_CORS)`
- Check origin matches exactly (including protocol and port)
- Restart dev server after changing `.env.local`

### Preflight OPTIONS Request Fails

**Causes**:
1. Middleware authentication blocking preflight
2. Invalid origin format in `TRUSTED_DOMAINS`

**Solutions**:
- Preflight should return 204 before authentication checks
- Ensure domain includes protocol: `https://app.example.com` not `app.example.com`

### CORS Headers Present but Request Still Blocked

**Causes**:
1. Browser enforcing additional security policies (CSP, SameSite cookies)
2. Authentication cookies not being sent (`credentials: 'include'` missing)

**Solutions**:
- Add `credentials: 'include'` to fetch requests
- Check cookie SameSite attribute (should be `Lax` or `None; Secure`)
- Verify no CSP headers blocking the request

---

## Production Deployment

### Vercel

Add environment variables in Vercel dashboard:

```
ENABLE_CORS=true
TRUSTED_DOMAINS=https://app.yourdomain.com,https://dashboard.yourdomain.com
```

### Docker

Add to `docker-compose.yml`:

```yaml
services:
  app:
    environment:
      - ENABLE_CORS=true
      - TRUSTED_DOMAINS=https://app.yourdomain.com
```

### Kubernetes

Add to ConfigMap:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  ENABLE_CORS: "true"
  TRUSTED_DOMAINS: "https://app.yourdomain.com"
```

---

## Security Best Practices

1. **Minimize Trusted Domains**: Only add domains you control
2. **Use HTTPS**: Never allow `http://` origins in production (except localhost for dev)
3. **Monitor CORS Logs**: Review logs for rejected origins (potential attack attempts)
4. **Combine with Rate Limiting**: CORS doesn't prevent DoS attacks
5. **Keep Webhook Routes Excluded**: Never add CORS to server-to-server endpoints
6. **Rotate Secrets Regularly**: CORS is secondary to cryptographic verification
7. **Test After Changes**: Run test suite after updating `TRUSTED_DOMAINS`

---

## Migration Guide

### From No CORS to CORS Enabled

1. **Backup Current Configuration**: Copy `.env.local`
2. **Add Environment Variables**: Set `ENABLE_CORS=true` and `TRUSTED_DOMAINS`
3. **Test Locally**: Start dev server and test cross-origin requests
4. **Run Test Suite**: `npm run test` to verify no regressions
5. **Deploy to Staging**: Test in production-like environment
6. **Monitor Logs**: Check for rejected origins or errors
7. **Deploy to Production**: Update environment variables

### From CORS Enabled to Disabled

1. **Set `ENABLE_CORS=false`**: Or remove the variable entirely
2. **Remove `TRUSTED_DOMAINS`**: Clean up unused configuration
3. **Update Client Code**: Ensure all API calls are same-origin
4. **Test Thoroughly**: Verify application still functions
5. **Deploy**: Push changes to production

---

## Additional Resources

- [MDN CORS Documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [OWASP CORS Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Origin_Resource_Sharing_Cheat_Sheet.html)
- [Next.js Security Best Practices](https://nextjs.org/docs/app/building-your-application/configuring/security)

---

## Support

For questions or issues with CORS configuration:

1. Check this documentation first
2. Review test suite for examples
3. Check application logs for error messages
4. Open an issue with:
   - Environment configuration (redact secrets)
   - Error messages from browser console
   - Network tab screenshots showing failed requests