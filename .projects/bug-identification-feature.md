# Bug Identification Feature

**Branch:** `feature/bug-identification`  
**Started:** 2025-07-25  
**Status:** Core Implementation Complete - Ready for Backend Integration

## Overview

Interactive bug identification system for Live Preview toolbar that maps UI elements to source code files. Users click a debug button, then click/drag on iframe content to identify which source files are responsible for specific UI elements.

## Architecture Summary

### Current Approach (Turbopack + SWC + Cross-Iframe)
**Key Insight:** Bug identification reads source mapping from **iframe content** (target repo), not Hive itself.

**Architecture:**
- **Hive (this repo):** Turbopack for performance, manages debug UI and chat integration
- **Target repo:** SWC provides React fiber source mapping via `_debugSource` 
- **Communication:** Secure postMessage API between Hive and iframe for coordinate exchange

## Implementation Status

### ✅ COMPLETED PHASES

#### Phase 1: Turbopack Compatibility ✅
- **Commit:** `497e37b` - Removed `.babelrc.js` causing Turbopack conflicts
- **Result:** Hive runs cleanly with Turbopack, no Babel dependencies
- **Files:** Cleaned `package.json`, restored `next.config.ts`

#### Phase 2: Debug UI & Chat Integration ✅  
- **Commits:** `57f1cb0`, `f5947a5`, `23e16a2`
- **Features:** 
  - 🐛 Debug button in Live Preview toolbar
  - Click/drag overlay with visual feedback
  - Coordinate capture (unified for clicks + selections)
  - Auto-disable after interaction + loading states
  - Chat message integration with formatted coordinates
- **Files:** `src/app/w/[slug]/task/[...taskParams]/artifacts/browser.tsx`

#### Phase 3: Cross-Iframe Communication ✅
- **Commit:** `6d75c59` - postMessage API implementation
- **Features:**
  - Secure origin-verified postMessage between Hive ↔ iframe
  - Timeout handling (10s) with graceful fallback
  - Message ID tracking for async responses
  - Error handling for CORS/communication failures
- **Files:** Updated `browser.tsx` with postMessage logic

#### Phase 4: Enhanced DOM Inspection ✅  
- **Commit:** `6d75c59` - React fiber extraction
- **Features:**
  - React fiber tree traversal (up to 5 levels)
  - SWC `_debugSource` extraction: `{fileName, lineNumber, columnNumber}`
  - Multi-point sampling for region selections (9 sample points)
  - `initializeDebugMessageListener()` for target repositories
- **Files:** Complete rewrite of `src/lib/dom-inspector.ts`

#### Phase 5: Backend Framework ✅
- **Commit:** `97b2f85` - Backend API + chat processing  
- **Features:**
  - `/api/debug-element` POST endpoint with auth + validation
  - Chat message regex detection of debug coordinates
  - Mock source file responses for testing
  - Assistant response generation with file:line format
- **Files:** `src/app/api/debug-element/route.ts`, `src/app/api/chat/message/route.ts`

### 🔄 REMAINING WORK

#### Phase 6: Backend Integration Update (In Progress)
**Current Issue:** Backend still expects to fetch iframe content server-side, but new architecture uses client-side postMessage.

**Required Changes:**
- **Update `/api/debug-element`:** Remove server-side DOM fetching, process coordinates from postMessage results
- **Simplify chat processing:** Backend should coordinate rather than extract DOM
- **Test mock responses:** Verify end-to-end flow with current postMessage implementation

#### Phase 7: Target Repository Setup (Pending)
**Documentation Needed:**
- How target repositories enable SWC source mapping  
- Sample implementation of `initializeDebugMessageListener()`
- Testing with actual Next.js app providing `_debugSource` data

#### Phase 8: End-to-End Testing (Pending)
**Testing Scenarios:**
- Cross-iframe communication with real target repo
- Source mapping accuracy with actual React components
- CORS handling and error scenarios
- Full chat integration with source file responses

## Technical Implementation Details

### Key Files Modified
```
✅ src/app/w/[slug]/task/[...taskParams]/artifacts/browser.tsx - Debug UI + postMessage
✅ src/lib/dom-inspector.ts - React fiber extraction + message listener  
✅ src/app/api/debug-element/route.ts - Backend API endpoint
✅ src/app/api/chat/message/route.ts - Chat debug message processing
✅ src/lib/chat.ts - Bug report types (BugReportContent interface)
✅ src/lib/constants.ts - Preview target URLs
✅ next.config.ts - SWC development mode comments
```

### postMessage API Protocol
```typescript
// Hive → Iframe
{
  type: 'debug-request',
  messageId: 'debug-timestamp-random',
  coordinates: { x: number; y: number; width: number; height: number }
}

// Iframe → Hive  
{
  type: 'debug-response',
  messageId: 'debug-timestamp-random',
  success: boolean,
  sourceFiles: Array<{file: string; lines: number[]; context?: string}>
}
```

### React Fiber Source Extraction
```typescript
// SWC automatically injects in development:
fiber._debugSource = {
  fileName: '/path/to/component.tsx',
  lineNumber: 42, 
  columnNumber: 8
}
```

## Integration Requirements

### For Target Repositories
1. **Enable SWC development mode** (default in Next.js)
2. **Add debug listener:**
```typescript
import { initializeDebugMessageListener } from '@/lib/dom-inspector';
initializeDebugMessageListener(); // In _app.tsx or layout
```
3. **Verify iframe access** - ensure CORS allows parent communication

### For Testing  
- **Mock target repo:** Create simple Next.js app with debug listener
- **Test iframe URL:** Point Hive browser artifacts to localhost:3001
- **Verify source data:** Confirm `_debugSource` appears in React fiber

## Benefits Achieved
- ✅ **Performance:** Turbopack compatibility maintained
- ✅ **Security:** Origin-verified postMessage communication  
- ✅ **Scalability:** Works with any SWC-enabled repository
- ✅ **User Experience:** Smooth click/drag interaction with visual feedback
- ✅ **Integration:** Seamless chat system integration with formatted responses

## Next Steps for Handover
1. **Complete backend integration** - update `/api/debug-element` for postMessage architecture
2. **Create target repo test setup** - sample Next.js app with debug listener
3. **End-to-end testing** - verify full flow from click → coordinates → source files → chat
4. **Documentation** - target repository setup guide and API documentation