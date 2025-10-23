# Hive Platform - React Architecture Analysis

## Executive Summary

This codebase is a sophisticated Next.js 15 application with 331 React components, 14 major workspace pages, and a complex data flow architecture. The application follows a hybrid composition pattern with both context-based global state (WorkspaceContext) and Zustand stores for feature-specific state. While well-organized in many areas, there are notable patterns of prop drilling and state management inconsistencies that present refactoring opportunities.

---

## 1. PROVIDER HIERARCHY & CONTEXT FLOW

### Root Provider Stack (app/layout.tsx)
```
<html>
  └─ <ToastProvider>
      └─ <ThemeProvider>
          └─ <SessionProvider> (NextAuth)
              └─ <WorkspaceProvider> ⭐ [PRIMARY CONTEXT]
                  └─ <QueryProvider> (TanStack React Query)
                      └─ <ModalClient>
                          └─ <ModalProvider> (Zustand-based)
                              └─ {children}
```

**Analysis:**
- **Properly Nested:** Providers are in logical order (theme → auth → workspace → server state → modals)
- **Single Context Only:** Only one major context (WorkspaceContext) is used - good for simplicity
- **Client-Side Boundary:** All 5 providers are "use client" components
- **TanStack Query:** Configured with 15s staleTime, 5min gcTime, refetchOnWindowFocus: false

---

## 2. WORKSPACE CONTEXT ARCHITECTURE

### WorkspaceContext (src/contexts/WorkspaceContext.tsx) - 300 lines
**Key Features:**
- **State Managed:** 
  - `workspace` - Current workspace data with access info
  - `workspaces` - List of user's workspaces
  - `loading`, `error` - Loading and error states
  - `waitingForInputCount` - Task notifications count
  - `role` - Current user role

- **Actions:**
  - `switchWorkspace()` - Navigate to different workspace
  - `refreshWorkspaces()` - Re-fetch workspace list
  - `refreshCurrentWorkspace()` - Force reload workspace
  - `refreshTaskNotifications()` - Poll notification count
  - `updateWorkspace()` - Update local workspace state

**Data Flow Pattern:**
```
URL Change → pathname effect
    ↓
Extract slug from URL
    ↓
Fetch /api/workspaces/{slug}
    ↓
Update WorkspaceContext state
    ↓
Trigger notification count fetch
```

**Hooks Built on Context:**
```
useWorkspace()
  - Wrapper around WorkspaceContext
  - Adds computed properties: isOwner, isAdmin, isPM, etc.
  - Helper methods: getWorkspaceById(), isCurrentWorkspace()

useWorkspaceAccess()
  - Permission checking: canRead, canWrite, canAdmin
  - Granular permissions object for features
  - hasRoleLevel() utility for role comparison
```

**Issues Identified:**
1. **Over-fetch on navigation** - Fetches notification count on every pathname change
2. **No query deduplication** - Multiple useEffects can trigger same API call
3. **Notification polling** - Could benefit from Pusher real-time updates
4. **useState for slot tracking** - currentLoadedSlug tracking seems fragile

---

## 3. COMPONENT HIERARCHY MAPS

### Dashboard/Workspace Layout Tree
```
RootLayout (app/layout.tsx) - Server
  └─ ToastProvider + Theme + SessionProvider + WorkspaceProvider + Query + Modal
      └─ DashboardLayout (components/DashboardLayout.tsx) - Client
          ├─ Sidebar (components/Sidebar.tsx) - Client
          │   ├─ WorkspaceSwitcher
          │   ├─ SidebarContent
          │   │   └─ NavUser
          │   └─ GlobalSearch
          └─ MainContent
              └─ {children}
                  ├─ Dashboard Page
                  ├─ Tasks Page
                  ├─ Insights Page
                  ├─ Learn Page
                  ├─ Task Chat Page
                  └─ etc.
```

**Data Flow in DashboardLayout:**
```
useWorkspace() → workspace, loading, error
         ↓
If loading: Show spinner
If error: Show error card
If no workspace: Show access denied
If valid: Render layout + Sidebar + content
```

### Task Page (Largest & Most Complex) - 903 lines
**Location:** `src/app/w/[slug]/task/[...taskParams]/page.tsx`

**Component Structure:**
```
TaskChatPage (Client, 903 lines)
├─ State Management (20+ useState)
│   ├─ messages, started, currentTaskId
│   ├─ projectId, taskTitle, stakworkProjectId
│   ├─ workflowStatus, claimedPodId
│   ├─ showCommitModal, isCommitting
│   └─ pendingDebugAttachment
│
├─ Hooks Used (8+)
│   ├─ useParams(), useRouter() - Navigation
│   ├─ useSession() - Auth
│   ├─ useWorkspace() - Context data
│   ├─ useTheme() - Theme
│   ├─ useTaskMode() - Zustand store
│   ├─ usePusherConnection() - WebSocket
│   ├─ useProjectLogWebSocket() - Logs
│   └─ useChatForm() - Webhook detection
│
├─ Event Handlers (10+)
│   ├─ handleStart() - Create task
│   ├─ handleSend() - Send message
│   ├─ handleArtifactAction() - Handle form artifacts
│   ├─ handleDebugMessage() - Debug attachments
│   ├─ handleCommit() - Generate commit
│   ├─ handleConfirmCommit() - Push changes
│   └─ dropPod() - Cleanup pod
│
└─ Conditional Rendering
    ├─ If !started: TaskStartInput
    └─ If started:
        ├─ If agent + artifacts: ResizablePanel [ChatArea | ArtifactsPanel]
        ├─ If agent: ChatArea full width
        ├─ If form + artifacts: ResizablePanel [ChatArea | ArtifactsPanel]
        └─ If form: ChatArea full width
        └─ CommitModal
```

**Prop Drilling in Task Page:**
```
TaskChatPage
  ├─ ChatArea (15 props) ⚠️
  │   ├─ messages
  │   ├─ onSend, onArtifactAction
  │   ├─ inputDisabled, isLoading
  │   ├─ logs, lastLogLine
  │   ├─ pendingDebugAttachment, onRemoveDebugAttachment
  │   ├─ workflowStatus, taskTitle
  │   ├─ stakworkProjectId, workspaceSlug
  │   └─ hasNonFormArtifacts, isChainVisible
  │   │
  │   └─ ChatInput (7 props)
  │       ├─ logs, onSend
  │       ├─ disabled, isLoading
  │       ├─ pendingDebugAttachment, onRemoveDebugAttachment
  │       └─ workflowStatus
  │
  ├─ AgentChatArea (11 props) ⚠️
  │   ├─ messages, onSend
  │   ├─ inputDisabled, isLoading
  │   ├─ logs, pendingDebugAttachment
  │   ├─ workflowStatus, taskTitle
  │   ├─ workspaceSlug, onCommit
  │   └─ isCommitting
  │
  ├─ ArtifactsPanel (2 props) ✓
  │   ├─ artifacts
  │   └─ onDebugMessage
  │
  └─ CommitModal (6 props) ✓
      ├─ isOpen, onClose, onConfirm
      ├─ initialCommitMessage, initialBranchName
      └─ isCommitting
```

**Issues in Task Page:**
1. **903 lines in single component** - Too large for maintainability
2. **15 props to ChatArea** - Clear prop drilling happening
3. **Multiple state concerns** - Messages, workflow, commits, pods all in one component
4. **Event handlers as callbacks** - 10+ callbacks passed down
5. **Complex conditional rendering** - 4 different layouts based on mode + artifacts

---

## 4. STATE MANAGEMENT PATTERNS

### Pattern 1: Workspace Context (Centralized, shared)
```typescript
// Global, shared across entire workspace
useWorkspace() → {
  workspace, slug, id, role, workspaces,
  loading, error, waitingForInputCount,
  switchWorkspace(), refreshWorkspaces(),
  refreshTaskNotifications()
}
```
**Used in:** DashboardLayout, Sidebar, GlobalSearch, most pages
**Concern:** Too many responsibilities - workspace, auth, notifications

### Pattern 2: Zustand Stores (Feature-specific)
```
/stores
├─ useCoverageStore - Test coverage visualization state
├─ useInsightsStore - Janitor recommendations filtering
├─ useModalsStore - Modal stack management
├─ useStakgraphStore (16KB!) - Graph visualization state
├─ useControlStore - Workflow control state
├─ useDataStore - Data visualization state
├─ useGraphStore - Graph rendering state
├─ useSchemaStore - Schema management state
└─ useSimulationStore - Physics simulation state
```

**Example: useInsightsStore**
```typescript
{
  recommendations, janitorConfig,
  loading, dismissedSuggestions,
  fetchRecommendations(),
  toggleJanitor(),
  acceptRecommendation()
}
```

**Analysis:**
- ✓ Good separation by feature
- ✗ No cross-store communication
- ✗ Each store is independent, can cause data inconsistency
- ✓ Devtools middleware for debugging

### Pattern 3: Local Component State (useState)
- **Task Page:** 20+ useState hooks
- **LearnChat:** Local message state
- **ChatInput:** Input field + mode selection
- **Most complex components:** Mix of local state + context + stores

---

## 5. DATA FLOW ANALYSIS

### User Authentication Flow
```
User Logs In
    ↓
SessionProvider (NextAuth) sets session
    ↓
useSession() available in components
    ↓
DashboardLayout checks session
    ↓
WorkspaceProvider fetches workspaces
    ↓
useWorkspace() provides workspace data
```

### Task Message Flow (with WebSocket)
```
User sends message
    ↓
TaskChatPage.handleSend()
    ↓
POST /api/tasks/{id}/messages
    ↓
Backend streams response (SSE)
    ↓
usePusherConnection() receives updates
    ↓
handleSSEMessage callback
    ↓
setMessages() updates state
    ↓
ChatArea re-renders
    ↓
ChatMessage components animate in
```

### Notification Update Flow
```
Workspace loaded
    ↓
fetchTaskNotifications()
    ↓
GET /api/workspaces/{slug}/tasks/notifications-count
    ↓
setWaitingForInputCount()
    ↓
Sidebar shows badge with count
```

---

## 6. CLIENT vs SERVER COMPONENT BOUNDARY

**Server Components (No "use client"):**
- `app/layout.tsx` - Root
- `app/w/[slug]/layout.tsx` - Workspace layout (fetches server session)
- All `page.tsx` files - Page components
- `app/w/[slug]/learn/page.tsx` - Learn page
- `app/w/[slug]/insights/page.tsx` - Insights page

**Client Components (151 total with "use client"):**
- All Providers
- DashboardLayout
- Sidebar + GlobalSearch
- All artifact/chat components
- Modal system
- Most feature components

**Boundary Issue:** 
```
app/w/[slug]/layout.tsx (Server)
  ↓ passes {children}
DashboardLayout (Client)
  ↓ children (page.tsx - technically server but rendered as client children)
  └─ Page Component
```

The boundary is at DashboardLayout - everything below is functionally client-side due to context/hooks dependency.

---

## 7. COMPLEX COMPONENT ANALYSIS

### Largest Components by Size:
1. **workflow/index.tsx** - 1,421 lines - Graph visualization
2. **features/FeaturesList.tsx** - 795 lines - Feature management
3. **insights/CoverageInsights.tsx** - 482 lines - Test coverage display
4. **modals/ServicesModal.tsx** - 454 lines - Services wizard
5. **WorkspaceSettings.tsx** - 430 lines - Settings form
6. **features/PhaseSection.tsx** - 424 lines - Phase management
7. **workflow/ImportNodeModal.tsx** - 410 lines - Import workflow

**Pattern:** These components combine:
- Data fetching + state management
- Complex rendering logic
- Multiple sub-components
- Form handling

---

## 8. PROP DRILLING ANALYSIS

### High Prop Drilling Areas ⚠️

**1. Task Chat Page (Identified)**
```
TaskChatPage
└─ ChatArea (15 props)
   └─ ChatInput (7 props)
   └─ ChatMessage (3+ props for each message)
```

**2. Learn Chat Page**
```
LearnChat
├─ LearnChatArea (many props)
└─ LearnSidebar (4+ props: workspaceSlug, onPromptClick, currentQuestion, refetchTrigger)
```

**3. Features/Roadmap Pages**
```
FeaturesList → RoadmapTasksTable → TableColumnHeaders → ...
RoadmapTaskList → RoadmapTaskItem → ...
PhaseSection → PhaseItem → ...
```

### Prop Drilling Consequences:
- **Hard to maintain** - Changes ripple through layers
- **Less reusable** - Components tightly coupled to parent state
- **Hard to test** - Mock all intermediate props
- **Performance** - All re-renders propagate down

### Current Anti-Pattern Example:
```typescript
// TaskChatPage passes this to ChatArea - 15 props!
<ChatArea
  messages={messages}
  onSend={handleSend}
  onArtifactAction={handleArtifactAction}
  inputDisabled={inputDisabled}
  isLoading={isLoading}
  hasNonFormArtifacts={hasNonFormArtifacts}
  isChainVisible={isChainVisible}
  lastLogLine={lastLogLine}
  logs={logs}
  pendingDebugAttachment={pendingDebugAttachment}
  onRemoveDebugAttachment={() => setPendingDebugAttachment(null)}
  workflowStatus={workflowStatus}
  taskTitle={taskTitle}
  stakworkProjectId={stakworkProjectId}
  workspaceSlug={slug}
/>
```

**Better Pattern Would Be:**
```typescript
// Create ChatContext to avoid prop drilling
const ChatContext = createContext<ChatContextType>(null);

// Wrap chat area in provider
<ChatProvider messages={messages} onSend={handleSend} {...}>
  <ChatArea /> // Pull from context
</ChatProvider>
```

---

## 9. ARCHITECTURAL PATTERNS OBSERVED

### Good Patterns ✓

1. **Hook Abstraction**
   - `useWorkspace()` - Encapsulates context access
   - `useWorkspaceAccess()` - Role-based access
   - Custom hooks for domain logic

2. **Zustand for Feature State**
   - Clear separation from global state
   - Devtools support
   - No boilerplate like Redux

3. **Modular Components**
   - Icons separated into `components/Icons/`
   - UI components in `components/ui/`
   - Feature components in `components/features/`

4. **Server Components**
   - Layouts fetch session server-side
   - Can reduce JS bundle

5. **Streaming & Real-time**
   - Pusher for live updates
   - SSE for streaming responses
   - WebSocket for logs

### Bad Patterns ✗

1. **Component Size**
   - TaskChatPage: 903 lines
   - workflow/index: 1,421 lines
   - Hard to understand intent

2. **Mixed State Management**
   - Context + Stores + useState in same component
   - No single source of truth for feature state
   - Store mutations not tied to component lifecycle

3. **Prop Drilling**
   - 15 props to ChatArea
   - Multiple levels of prop passing
   - No intermediate abstraction

4. **Missing Abstraction Boundaries**
   - Task page handles: messages, commits, pods, workflows, artifacts
   - No clear separation of concerns
   - Testing would require mocking everything

5. **Conditional Rendering Complexity**
   - 4 different layouts based on mode + artifacts flag
   - Hard to follow logic flow
   - Easy to miss edge cases

6. **fetch() Instead of TanStack Query**
   - Manual error handling
   - No built-in deduplication
   - No cache management
   - TanStack Query available but underutilized

---

## 10. REAL-TIME & ASYNC PATTERNS

### Pusher Integration
```
Websocket Connection (usePusherConnection)
  ├─ Listens for task messages
  ├─ Listens for workflow status updates
  ├─ Listens for task title changes
  └─ Listens for recommendations updates
```

**Issue:** Each feature has separate Pusher listener hooks
- Not centralized, scattered across pages

### Manual Polling (Anti-pattern)
```
// In WorkspaceProvider
useEffect(() => {
  if (workspace?.slug && status === "authenticated") {
    fetchTaskNotifications(workspace.slug); // Runs on every pathname change!
  }
}, [pathname, workspace?.slug, status, fetchTaskNotifications]);
```

**Issue:** Polling every pathname change instead of event-driven

---

## 11. IDENTIFIED REFACTORING OPPORTUNITIES

### Priority 1: Task Page Refactoring (High Impact)
**Current:** 903-line monolithic component
**Problem:** Too many responsibilities
**Solution:** Split into focused contexts + components
```typescript
// Create TaskChatContext for all task-related state
// Create ChatContext for message/input state
// Create ArtifactContext for artifact state
// Create CommitContext for commit flow

TaskChatPage
  ├─ TaskProvider
  │   ├─ ChatProvider
  │   │   ├─ ChatArea (5 props)
  │   │   └─ ChatInput (3 props)
  │   ├─ ArtifactProvider
  │   │   └─ ArtifactsPanel (2 props)
  │   └─ CommitProvider
  │       └─ CommitModal (3 props)
```

### Priority 2: Notification Polling (Medium Impact)
**Current:** Polling on every pathname change
**Problem:** Inefficient, rate-limited
**Solution:** Event-driven updates via Pusher
```typescript
// Use Pusher for real-time notifications
// Only fetch on workspace change
// Cache for 30 seconds
```

### Priority 3: Replace fetch() with TanStack Query (Medium Impact)
**Current:** Manual fetch + useState
**Problem:** No deduplication, no cache, no background refresh
**Solution:** Use useQuery for all data fetching
```typescript
const { data: messages } = useQuery({
  queryKey: ['task', taskId, 'messages'],
  queryFn: () => fetch(`/api/tasks/${taskId}/messages`)
})
```

### Priority 4: Component Size Reduction (Low-Medium Impact)
**Current:** 
- workflow/index: 1,421 lines
- FeaturesList: 795 lines
**Problem:** Hard to understand, test, maintain
**Solution:** Extract sub-components

### Priority 5: Modal System Improvement (Low Impact)
**Current:** useModal() with string registry
**Problem:** Hard to track which modals exist, no type safety
**Solution:** Typed modal system

---

## SUMMARY OF ARCHITECTURAL ISSUES

### Critical Issues (Fix Soon):
1. Task page is 903 lines - Split into smaller components/contexts
2. Prop drilling in chat components - Create ChatContext
3. Polling instead of events - Use Pusher for notifications

### Major Issues (Plan Refactor):
4. Manual fetch() everywhere - Migrate to TanStack Query
5. Component sizes > 400 lines - Break into sub-components
6. Mixed state management - Consolidate per-feature
7. No error boundaries - Add ErrorBoundary wrappers

### Minor Issues (Nice to Have):
8. Modal type safety - Create typed modal system
9. Performance optimization - Add memo() to list items
10. Store cross-communication - Create event system

---

## RECOMMENDATIONS

### Short Term (Weeks 1-2):
1. Extract ChatContext from TaskChatPage
2. Move notification polling to event-driven (Pusher)
3. Add ErrorBoundary to critical pages
4. Add useMemo() to lists with 10+ items

### Medium Term (Weeks 3-6):
5. Refactor task page into smaller contexts
6. Migrate manual fetch() to useQuery()
7. Split workflow/index into sub-components
8. Create typed modal system

### Long Term (Weeks 7+):
9. Extract shared feature hooks
10. Build internal component library
11. Add performance monitoring
12. Refactor large feature pages

