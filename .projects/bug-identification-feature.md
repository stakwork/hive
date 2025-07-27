# Bug Identification Feature

**Branch:** `feature/bug-identification`  
**Started:** 2025-07-25  
**Status:** In Development

## Overview

Implement a bug identification system that allows users to click an "Identify Bug" button in the Live Preview toolbar, describe a bug, and get back file:line mappings of the source code responsible for the UI elements mentioned in the bug description.

## Technical Approach

### Phase 1: Babel Plugin Setup
- Add `@babel/plugin-transform-react-jsx-source` and `@react-dev-inspector/babel-plugin` as dev dependencies
- Configure Babel to inject `data-source` attributes in development builds only
- Update Next.js config to use Babel with Turbopack in development
- Verify DOM elements have source mapping attributes

### Phase 2: Iframe Target Configuration  
- Set default iframe target to `hive-vercel.sphinx.chat`
- Create proxy API route for handling CORS/same-origin issues
- Ensure parent can read iframe DOM for source extraction

### Phase 3: "Identify Bug" Button Flow
- Add Bug icon button to browser artifact toolbar
- Create hook for bug identification logic
- Implement DOM extraction to find elements matching bug description text
- Extract `data-source` attributes from matching elements
- Return file:line pairs

### Phase 4: Output Display
- Create new `BUG_REPORT` artifact type
- Build bug report display component
- Show file paths and line numbers in chat panel
- Simple text-based output format

## Implementation Details

### Key Files Modified
- `next.config.ts` - Babel configuration for Turbopack
- `src/app/w/[slug]/task/[...taskParams]/artifacts/browser.tsx` - Identify Bug button
- `src/lib/chat.ts` - Bug report types
- `src/lib/constants.ts` - Preview target URLs

### New Files Created
- `.babelrc.js` - Babel plugin configuration
- `src/app/api/proxy-preview/route.ts` - CORS proxy
- `src/hooks/useBugIdentification.ts` - Bug identification logic
- `src/lib/dom-inspector.ts` - DOM extraction utilities
- `src/app/w/[slug]/task/[...taskParams]/artifacts/bug-report.tsx` - Bug report display

## Testing Strategy
- Verify `data-source` attributes appear in dev build
- Test iframe can access target URL DOM
- Test bug identification with sample descriptions
- Verify no impact on production builds

## Integration Points
- Leverages existing chat/artifact system
- Works with current browser preview infrastructure
- Compatible with repository connection feature