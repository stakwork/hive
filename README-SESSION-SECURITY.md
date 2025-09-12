# Session Token Security Implementation

This document describes the enhanced session token security features implemented to address security concerns with long-lived sessions and lack of refresh token rotation.

## Overview

The session token security improvements include:

1. **Reduced Session Duration**: Access tokens now expire after 15 minutes (down from 30 days)
2. **Refresh Token Rotation**: Automatic rotation of refresh tokens for enhanced security
3. **Proactive Token Refresh**: Tokens are refreshed 5 minutes before expiration
4. **Error Handling**: Graceful handling of token refresh failures with automatic re-authentication

## Key Changes

### Authentication Configuration (`src/lib/auth/nextauth.ts`)

- **Session Strategy**: Now always uses JWT strategy for refresh token support
- **Session Duration**: 
  - Access tokens: 15 minutes
  - Refresh tokens: 7 days (rotated on each use)
  - Session update: Every 5 minutes if active
- **Token Refresh**: Automatic refresh when tokens are within 5 minutes of expiration
- **Error Handling**: Proper error states for failed token refresh attempts

### New Components

1. **AuthErrorHandler** (`src/components/AuthErrorHandler.tsx`): Handles token refresh errors and redirects to sign-in
2. **SessionProvider** (`src/providers/SessionProvider.tsx`): Enhanced session provider with automatic refresh
3. **Middleware** (`src/middleware.ts`): Route protection with token validation
4. **useTokenRefresh Hook** (`src/hooks/useTokenRefresh.ts`): Custom hook for monitoring token status

## Security Benefits

1. **Reduced Attack Surface**: Short-lived access tokens limit exposure if compromised
2. **Automatic Token Rotation**: Refresh tokens are rotated on each use, preventing replay attacks
3. **Proactive Refresh**: Tokens are refreshed before expiration, reducing user disruption
4. **Graceful Degradation**: Failed token refresh triggers re-authentication rather than application errors

## Configuration

### Environment Variables

Ensure these environment variables are set:

```env
NEXTAUTH_SECRET=your_nextauth_secret
NEXTAUTH_URL=https://your-domain.com
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
```

### Token Lifetimes

Current configuration (can be adjusted in `nextauth.ts`):

- Access Token: 15 minutes
- Refresh Token: 7 days
- Session Update Interval: 5 minutes
- Token Refresh Threshold: 5 minutes before expiration

## Usage

### Client-Side Session Handling

```tsx
import { useSession } from "next-auth/react";
import { useTokenRefresh } from "@/hooks/useTokenRefresh";

function MyComponent() {
  const { data: session, status } = useSession();
  const { isRefreshing, hasError } = useTokenRefresh();

  if (status === "loading" || isRefreshing) {
    return <div>Loading...</div>;
  }

  if (hasError) {
    return <div>Please sign in again</div>;
  }

  return <div>Welcome, {session?.user?.name}!</div>;
}
```

### Server-Side Session Validation

```tsx
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";

export default async function ProtectedPage() {
  const session = await getServerSession(authOptions);

  if (!session || session.error === "RefreshAccessTokenError") {
    redirect("/auth/signin");
  }

  return <div>Protected content</div>;
}
```

## Migration Notes

### Existing Sessions

- Users with existing long-lived sessions will be gradually migrated to the new token system
- First request after deployment will trigger token refresh and shorter session duration
- No user action required for migration

### Database Changes

- No database schema changes required
- Existing `Account.refresh_token` and `Account.access_token` fields are utilized
- Tokens are encrypted using the existing `EncryptionService`

## Monitoring

### Token Refresh Success/Failure

Monitor your application logs for:

- `Token refresh failed, user needs to re-authenticate`
- `Error during token refresh`
- `Session expired, redirecting to sign in`

### Session Duration Metrics

Track session duration and refresh frequency to optimize token lifetimes based on usage patterns.

## Troubleshooting

### Common Issues

1. **Frequent Re-authentication**: May indicate issues with token refresh - check GitHub OAuth app configuration
2. **Session Errors**: Ensure `NEXTAUTH_SECRET` is set and consistent across deployments
3. **Token Refresh Failures**: Verify GitHub OAuth app has necessary scopes and credentials are valid

### Debug Mode

Enable debug logging by setting:

```env
NEXTAUTH_DEBUG=1
```

This will provide detailed logs of token refresh attempts and session management.

## Security Considerations

1. **Refresh Token Storage**: Refresh tokens are encrypted at rest using `EncryptionService`
2. **Token Transmission**: All tokens are transmitted over HTTPS only
3. **Session Fixation**: JWT strategy prevents session fixation attacks
4. **Token Rotation**: Each refresh generates new tokens, preventing token reuse

## Future Enhancements

Potential improvements for consideration:

1. **Dynamic Token Lifetimes**: Adjust token lifetime based on user activity patterns
2. **Device-Specific Tokens**: Different token lifetimes for mobile vs desktop clients
3. **Risk-Based Authentication**: Shorter token lifetimes for high-risk activities
4. **Token Blacklisting**: Maintain a blacklist of revoked tokens for enhanced security