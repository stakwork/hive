# Dynamic Favicon Implementation

## Overview
The browser tab favicon now automatically updates to match the workspace's custom icon when a logo is uploaded. This provides better visual identification when users have multiple workspaces open in different tabs.

## Implementation

### Files Created
1. **`src/hooks/useWorkspaceFavicon.ts`** - Custom React hook that handles favicon updates
2. **`src/components/WorkspaceFaviconUpdater.tsx`** - Client component that integrates the hook into the workspace layout

### Files Modified
1. **`src/components/DashboardLayout.tsx`** - Added `WorkspaceFaviconUpdater` component to enable dynamic favicon updates

## How It Works

### Flow
1. When a user navigates to a workspace (`/w/[slug]`), the `DashboardLayout` renders
2. `WorkspaceFaviconUpdater` component is mounted, which uses the `useWorkspaceFavicon` hook
3. The hook retrieves workspace data from `WorkspaceContext` via `useWorkspace()`
4. If the workspace has a `logoKey`:
   - Fetches the presigned URL from `/api/workspaces/[slug]/image`
   - Updates all favicon link elements in the document head
   - Sets the workspace logo as the browser tab icon
5. If no logo exists or fetch fails:
   - Restores default Hive favicon
6. When navigating away from the workspace:
   - Cleanup function restores default favicon

### Technical Details

#### Favicon Update Process
```typescript
// Remove existing favicon links
document.querySelectorAll('link[rel*="icon"]').forEach(icon => icon.remove());

// Add workspace logo as favicon
const link = document.createElement('link');
link.rel = 'icon';
link.href = workspaceLogoUrl;
document.head.appendChild(link);
```

#### Default Favicon Restoration
When no workspace logo is available, the hook restores the default Hive favicons:
- `/favicon-16x16.png` (or `/dev/favicon-16x16.png` in dev mode)
- `/favicon-32x32.png` (or `/dev/favicon-32x32.png` in dev mode)
- `/favicon.ico` (or `/dev/favicon.ico` in dev mode)
- `/apple-touch-icon.png` (or `/dev/apple-touch-icon.png` in dev mode)

## Feature Flag
The feature is controlled by the `WORKSPACE_LOGO` feature flag:
- Environment variable: `NEXT_PUBLIC_FEATURE_WORKSPACE_LOGO=true`
- If disabled, the hook returns early and no favicon updates occur

## Edge Cases Handled

### 1. No Workspace Logo
When a workspace has no custom logo (`logoKey` is null):
- Default Hive favicon is displayed
- No API call is made

### 2. Logo Fetch Failure
If the API request fails (network error, 404, etc.):
- Error is logged to console
- Default favicon is restored
- User experience is not interrupted

### 3. Navigation Between Workspaces
When switching from one workspace to another:
- Cleanup function runs, restoring default favicon temporarily
- New workspace's favicon is fetched and applied
- Smooth transition between workspace icons

### 4. Navigation Away from Workspace
When leaving workspace pages:
- Cleanup function restores default Hive favicon
- Ensures consistent branding on non-workspace pages

### 5. Feature Flag Disabled
When `WORKSPACE_LOGO` feature is disabled:
- Hook returns early without any DOM manipulation
- Static favicons from `metadata.ts` remain in effect

## Browser Compatibility
The implementation uses standard DOM APIs supported by all modern browsers:
- `document.createElement()`
- `document.head.appendChild()`
- `document.querySelectorAll()`
- `Element.remove()`

Tested browser support:
- Chrome/Edge (Chromium-based)
- Firefox
- Safari
- Mobile browsers (iOS Safari, Chrome Mobile)

## Performance Considerations

### Efficient API Calls
- Favicon URL is only fetched when workspace has a `logoKey`
- Uses existing `/api/workspaces/[slug]/image` endpoint (presigned URL, 1-hour cache)
- No redundant API calls when workspace doesn't change

### DOM Manipulation
- Minimal DOM updates (only when workspace changes)
- Cleanup properly removes old links before adding new ones
- No memory leaks from orphaned link elements

## Testing Recommendations

### Manual Testing
1. **Upload workspace logo**:
   - Go to workspace settings
   - Upload a custom logo
   - Verify browser tab icon changes to the uploaded image

2. **Remove workspace logo**:
   - Remove the custom logo from workspace settings
   - Verify browser tab icon reverts to default Hive favicon

3. **Switch workspaces**:
   - Navigate to workspace A with custom logo
   - Verify favicon shows workspace A's logo
   - Switch to workspace B with different logo
   - Verify favicon updates to workspace B's logo
   - Switch to workspace C with no logo
   - Verify favicon shows default Hive icon

4. **Navigation**:
   - Navigate from workspace to non-workspace page (e.g., `/workspaces`)
   - Verify favicon reverts to default Hive icon

### Automated Testing
Consider adding tests for:
- Hook behavior when workspace has logo
- Hook behavior when workspace has no logo
- API error handling
- Feature flag toggle
- Cleanup function execution

## Future Enhancements

### Potential Improvements
1. **Cache workspace logo URLs** - Store fetched URLs in memory to avoid repeated API calls
2. **Preload favicons** - Preload workspace logos for faster switching
3. **Fallback to workspace initial** - Generate a colored favicon with workspace's first letter if no logo
4. **Favicon service worker** - Cache favicon URLs in service worker for offline support

## Troubleshooting

### Favicon Not Updating
1. Check if `NEXT_PUBLIC_FEATURE_WORKSPACE_LOGO` is set to `'true'`
2. Verify workspace has a valid `logoKey` in the database
3. Check browser console for API errors
4. Clear browser cache and reload

### Default Favicon Not Restoring
1. Verify favicon files exist in `/public` directory
2. Check `isDevelopmentMode()` returns correct value
3. Ensure cleanup function is running (check React DevTools)

### Multiple Favicons in Head
1. This shouldn't happen due to cleanup logic
2. If it does, check for conflicting favicon-setting code elsewhere
3. Verify `document.querySelectorAll('link[rel*="icon"]')` selector is correct
