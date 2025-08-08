# Feature Flags

Simple .env-based feature flags with role-based access control.

## Quick Setup

### 1. Create the utility

```typescript
// src/lib/feature-flags.ts
import { WorkspaceRole } from '@prisma/client';

export function canAccessFeature(feature: string, userRole?: WorkspaceRole): boolean {
  const isEnabled = process.env[`FEATURE_${feature.toUpperCase()}`] === 'true';
  if (!isEnabled) return false;

  const roleRequirements: Record<string, WorkspaceRole[]> = {
    'CHAT': ['ADMIN', 'OWNER'],
    'BULK_OPERATIONS': ['ADMIN', 'OWNER', 'PM'],
    'ADVANCED_ANALYTICS': ['OWNER'],
  };

  const allowedRoles = roleRequirements[feature];
  if (!allowedRoles) return true; // No role restriction
  return userRole ? allowedRoles.includes(userRole) : false;
}
```

### 2. Create the hook

```typescript
// src/hooks/useFeatureFlag.ts
import { canAccessFeature } from '@/lib/feature-flags';
import { useWorkspace } from '@/hooks/useWorkspace';

export function useFeatureFlag(feature: string): boolean {
  const { role } = useWorkspace();
  return canAccessFeature(feature, role);
}
```

### 3. Add environment variables

```bash
# .env.local
FEATURE_CHAT=true
FEATURE_BULK_OPERATIONS=false
```

## Usage

### Components

```typescript
export function ChatFeature() {
  const canAccessChat = useFeatureFlag('CHAT');
  if (!canAccessChat) return null;
  return <ChatInterface />;
}

// Navigation
export function Nav() {
  const canAccessChat = useFeatureFlag('CHAT');
  return (
    <nav>
      <NavItem href="/dashboard">Dashboard</NavItem>
      {canAccessChat && <NavItem href="/chat">Chat</NavItem>}
    </nav>
  );
}
```

### API Routes

```typescript
// Check feature access in API routes
const userRole = workspace.members.find(m => m.userId === session?.user?.id)?.role;
if (!canAccessFeature('CHAT', userRole)) {
  return NextResponse.json({ error: 'Feature not available' }, { status: 404 });
}
```

### Pages

```typescript
export default function ChatPage() {
  const { role } = useWorkspace();
  
  if (!canAccessFeature('CHAT', role)) {
    return <AccessDenied message="Chat is admin-only" />;
  }
  
  return <ChatFeature />;
}
```

## Role Hierarchy

- `OWNER` - All features
- `ADMIN` - Admin features  
- `PM` - Product features
- `DEVELOPER` - Dev features
- `STAKEHOLDER` - Limited features
- `VIEWER` - Basic access

## Adding New Features

1. Add to `.env.local`: `FEATURE_NEW_THING=true`
2. Add role requirements to `roleRequirements` object (optional)
3. Use `useFeatureFlag('NEW_THING')` in components

## Rollout Strategy

1. **Owner only**: `['OWNER']`
2. **Expand**: `['ADMIN', 'OWNER']` 
3. **Broader**: `['PM', 'ADMIN', 'OWNER']`
4. **Full rollout**: Remove role restrictions

## Testing

```typescript
test('allows ADMIN access when enabled', () => {
  process.env.FEATURE_CHAT = 'true';
  expect(canAccessFeature('CHAT', 'ADMIN')).toBe(true);
});
```