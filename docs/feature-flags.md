# Feature Flags

Environment-based feature flags with role-based access control for Next.js applications.

## Next.js Specific Considerations

**IMPORTANT:** Next.js has specific requirements for environment variables in client-side code:

1. **Client-side variables** must be prefixed with `NEXT_PUBLIC_`
2. **Dynamic env var access** (`process.env[dynamicKey]`) doesn't work in client-side code
3. **Explicit references** to environment variables are required for build-time optimization

## Quick Setup

### 1. Create the utility

```typescript
// src/lib/feature-flags.ts
import { WorkspaceRole } from '@prisma/client';

export function canAccessFeature(feature: string, userRole?: WorkspaceRole): boolean {
  let isEnabled = false;
  
  // Map feature names to their environment variables
  // This is needed because Next.js requires explicit env var references
  switch (feature) {
    case 'CODEBASE_RECOMMENDATION':
      isEnabled = process.env.NEXT_PUBLIC_FEATURE_CODEBASE_RECOMMENDATION === 'true';
      break;
    default:
      isEnabled = false;
  }
  
  if (!isEnabled) return false;

  const roleRequirements: Record<string, WorkspaceRole[]> = {
    'CODEBASE_RECOMMENDATION': [], // No role restriction - available to all when enabled
  };

  const allowedRoles = roleRequirements[feature];
  if (!allowedRoles) return true; // No role restriction
  if (allowedRoles.length === 0) return true; // Explicitly no role restriction
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
  return canAccessFeature(feature, role ?? undefined);
}
```

### 3. Add environment variables

```bash
# .env.local - Client-side feature flags (for components)
NEXT_PUBLIC_FEATURE_CODEBASE_RECOMMENDATION=true

# Server-side only feature flags (for API routes)
FEATURE_ADMIN_PANEL=true
```

## Usage

### Client-side Components

```typescript
export function InsightsFeature() {
  const canAccessInsights = useFeatureFlag('CODEBASE_RECOMMENDATION');
  if (!canAccessInsights) return null;
  return <InsightsInterface />;
}

// Navigation example from Sidebar.tsx
export function Nav() {
  const canAccessInsights = useFeatureFlag('CODEBASE_RECOMMENDATION');
  
  const navigationItems = canAccessInsights 
    ? [
        { icon: CheckSquare, label: "Tasks", href: "/tasks" },
        { icon: BarChart3, label: "Insights", href: "/insights" },
        { icon: Settings, label: "Settings", href: "/settings" },
      ]
    : [
        { icon: CheckSquare, label: "Tasks", href: "/tasks" },
        { icon: Settings, label: "Settings", href: "/settings" },
      ];
      
  return <NavItems items={navigationItems} />;
}
```

### Server-side API Routes

```typescript
// For server-side feature flags (no NEXT_PUBLIC_ prefix needed)
import { canAccessFeature } from '@/lib/feature-flags';

export async function GET() {
  const userRole = workspace.members.find(m => m.userId === session?.user?.id)?.role;
  if (!canAccessFeature('CODEBASE_RECOMMENDATION', userRole)) {
    return NextResponse.json({ error: 'Feature not available' }, { status: 404 });
  }
  
  // Feature is enabled and user has access
  return NextResponse.json({ data: 'insights data' });
}
```

**Note:** Server-side feature flags can use the standard `FEATURE_NAME=true` format without `NEXT_PUBLIC_` prefix.

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