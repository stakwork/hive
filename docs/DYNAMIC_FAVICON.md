# Dynamic Favicon Feature

## Overview

This feature automatically updates the browser's favicon to match the custom icon of the current workspace. When a user navigates to a workspace that has a custom logo uploaded, the browser tab's favicon will display that workspace's logo instead of the default Hive favicon.

## Implementation

### Components

#### 1. `useFavicon` Hook (`src/hooks/useFavicon.ts`)

A React hook that manages dynamic favicon updates in the browser.

**Features:**
- Updates all favicon link elements (`favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`)
- Stores original favicon URLs to enable restoration
- Supports both workspace logos and default favicons
- Respects development/production environment favicon paths
- Can be enabled/disabled via the `enabled` parameter

**Usage:**
```typescript
import { useFavicon } from '@/hooks/useFavicon';

function MyComponent() {
  const workspaceLogoUrl = 'https://example.com/logo.png';
  
  useFavicon({ 
    workspaceLogoUrl,  // URL of the workspace logo
    enabled: true      // Whether to update favicon
  });
}
```

**Parameters:**
- `workspaceLogoUrl` (string | null | undefined): The URL of the workspace logo. When `null` or `undefined`, reverts to default favicon.
- `enabled` (boolean, default: `true`): Whether the hook should update the favicon.

#### 2. `FaviconManager` Component (`src/components/FaviconManager.tsx`)

A client-side component that manages favicon restoration when navigating away from workspace pages.

**Features:**
- Monitors the current pathname
- Automatically restores default favicon when user navigates to non-workspace pages
- Renders nothing (null component)

**Integration:**
The component is integrated into the root layout (`src/app/layout.tsx`) to provide app-wide favicon management.

#### 3. `DashboardLayout` Modifications (`src/components/DashboardLayout.tsx`)

The workspace dashboard layout has been enhanced to:
- Fetch the workspace logo URL when a workspace is loaded
- Update the favicon when the workspace has a custom logo
- Reset the favicon when the workspace changes or is unloaded

**How it works:**
1. When a workspace is loaded, it checks if the workspace has a `logoKey`
2. If yes, it fetches the presigned URL for the workspace logo via `/api/workspaces/[slug]/image`
3. The logo URL is passed to the `useFavicon` hook
4. The hook updates all favicon elements in the document head

## User Experience

### Workspace with Custom Logo

1. User uploads a custom logo for their workspace via workspace settings
2. The logo is stored in S3 with a `logoKey` in the workspace record
3. When the user navigates to that workspace:
   - The workspace logo is fetched
   - The browser's favicon is updated to show the workspace logo
   - All browser tabs for that workspace display the custom logo

### Workspace without Custom Logo

1. When the user navigates to a workspace without a custom logo:
   - The favicon remains as the default Hive favicon
   - No changes are made to the browser tab icon

### Navigation Between Workspaces

1. User switches from Workspace A (with custom logo) to Workspace B (with different logo):
   - The favicon updates from Workspace A's logo to Workspace B's logo
   - The transition is smooth and automatic

2. User switches from Workspace A (with custom logo) to Workspace B (without custom logo):
   - The favicon reverts to the default Hive favicon

### Navigation to Non-Workspace Pages

1. User navigates from a workspace page to the landing page, settings, or other non-workspace pages:
   - The `FaviconManager` detects the pathname change
   - The favicon is restored to the default Hive favicon

## Technical Details

### Favicon Update Mechanism

The `useFavicon` hook uses DOM manipulation to update favicon elements:

1. **Storing Original URLs:**
   - On first update, stores the original `href` in `dataset.originalHref`
   - This enables restoration of the original favicon

2. **Updating to Workspace Logo:**
   - Finds all favicon link elements using `querySelectorAll`
   - Updates each element's `href` to the workspace logo URL

3. **Restoring Default Favicon:**
   - Checks for stored `originalHref` in dataset
   - If found, restores from stored value
   - Otherwise, reconstructs default path based on environment and element attributes

### Environment Support

The implementation respects the development/production environment:
- **Production:** Uses favicons from `/favicon-*.png`
- **Development:** Uses favicons from `/dev/favicon-*.png` (purple-branded dev favicons)

This is determined via the `isDevelopmentMode()` function from `@/lib/runtime`.

### API Integration

The implementation uses the existing workspace logo API:
- **Endpoint:** `GET /api/workspaces/[slug]/image`
- **Returns:** `{ presignedUrl: string, expiresIn: number }`
- **Access Control:** Requires authentication and workspace access

## Testing

A comprehensive test suite has been created at `src/__tests__/unit/hooks/useFavicon.test.ts` covering:

1. ✅ Updating favicon with workspace logo URL
2. ✅ Restoring default favicon when workspaceLogoUrl is null
3. ✅ Not updating favicon when enabled is false
4. ✅ Handling transitions between different workspace logos

### Running Tests

```bash
npm test -- useFavicon.test.ts
```

## Files Modified/Created

### Created Files:
1. `src/hooks/useFavicon.ts` - Core favicon management hook
2. `src/components/FaviconManager.tsx` - Favicon restoration component
3. `src/__tests__/unit/hooks/useFavicon.test.ts` - Test suite

### Modified Files:
1. `src/components/DashboardLayout.tsx` - Added workspace logo fetching and favicon update
2. `src/app/layout.tsx` - Added FaviconManager component

## Future Enhancements

Potential improvements for future iterations:

1. **Caching:** Cache workspace logo URLs to reduce API calls
2. **Preloading:** Preload workspace logos when listing workspaces
3. **Favicon Generation:** Auto-generate multiple sizes from workspace logo
4. **Browser Compatibility:** Test and enhance cross-browser support
5. **Performance:** Optimize DOM manipulation and reduce re-renders

## Browser Compatibility

The feature uses standard Web APIs:
- `document.querySelectorAll()` - Supported in all modern browsers
- `dataset` API - Supported in all modern browsers
- `HTMLLinkElement.href` - Supported in all browsers

No special polyfills or fallbacks are needed for modern browsers (Chrome, Firefox, Safari, Edge).
