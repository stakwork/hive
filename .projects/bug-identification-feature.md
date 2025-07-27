# Bug Identification Feature

**Branch:** `feature/bug-identification`  
**Started:** 2025-07-25  
**Status:** Pivoting Approach (Turbopack + SWC)

## Overview

Implement a bug identification system that allows users to click an "Identify Bug" button in the Live Preview toolbar, describe a bug, and get back file:line mappings of the source code responsible for the UI elements mentioned in the bug description.

## Approach Evolution

### Previous Approach (Babel-based)
Initially implemented using Babel plugins to inject source mapping data directly into DOM elements:
- **Problem:** Conflict with Turbopack - requires Babel but Turbopack doesn't support Babel yet
- **Solution Attempted:** `.babelrc.js` with `@react-dev-inspector/babel-plugin` 
- **Result:** Server startup failure due to Turbopack/Babel incompatibility
- **Data Format:** `data-inspector-relative-path`, `data-inspector-line` DOM attributes

### Current Approach (Turbopack + SWC)
**Key Insight:** Bug identification needs source mapping in the **iframe content** (target repo), not Hive itself.

**Architecture:**
- **Hive (this repo):** Keeps Turbopack for performance, manages iframe
- **Target repo:** Uses SWC's built-in source mapping via `__source`/`__self` props
- **Data Access:** Read from React fiber (`fiber._debugSource`) instead of DOM attributes

## Current Technical Approach

### Phase 1: Turbopack Configuration
- Remove `.babelrc.js` from Hive (restore Turbopack compatibility)
- Ensure target repo uses Turbopack with SWC development mode
- Verify SWC provides `__source` data in target repo's React components

### Phase 2: Cross-Iframe Architecture
- Target repo runs own dev server with source mapping enabled
- Hive iframe points to target repo's dev server (e.g., localhost:3001)
- Implement postMessage communication between Hive and iframe

### Phase 3: Updated DOM Inspection
- Modify DOM inspector to read from React fiber instead of data attributes
- Extract `fiber._debugSource: { fileName, lineNumber, columnNumber }`
- Handle absolute vs relative path conversion for display

### Phase 4: Source Extraction Flow
- User clicks debug coordinates in Hive
- Send coordinates to iframe via postMessage
- Iframe finds elements at coordinates
- Extract source info from React fiber
- Return file:line data to Hive for chat display

## Implementation Details

### Files Modified (Previous)
- ~~`next.config.ts`~~ - No longer needed for Babel config
- `src/app/w/[slug]/task/[...taskParams]/artifacts/browser.tsx` - Debug button (completed)
- `src/lib/chat.ts` - Bug report types (completed)
- `src/lib/constants.ts` - Preview target URLs (completed)

### Files to Modify (Current Plan)
- Remove: `.babelrc.js` - Caused Turbopack conflict
- Update: `src/lib/dom-inspector.ts` - Switch to fiber-based extraction
- Update: `src/hooks/useBugIdentification.ts` - Cross-iframe communication
- Target repo: Ensure SWC development mode enabled

### New Cross-Iframe Communication
- postMessage API for coordinate passing
- Source extraction within iframe context
- Safe cross-origin data transfer

## Benefits of New Approach
- **Performance:** Turbopack everywhere (700x faster than webpack)
- **Consistency:** Both Hive and target repos use same tech stack
- **Future-proof:** SWC is Next.js default compiler
- **Scalability:** Works with any repository we can configure

## Testing Strategy
- Verify Hive starts without Babel errors
- Test target repo provides `fiber._debugSource` data
- Test cross-iframe coordinate communication
- Verify source extraction and file mapping accuracy
- No impact on production builds (development-only feature)

## Integration Points
- Leverages existing chat/artifact system ✅
- Works with browser preview infrastructure ✅  
- Compatible with repository connection feature
- Cross-iframe postMessage communication (new)