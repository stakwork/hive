# Migrating Routes from `getServerSession` to Middleware Auth

These routes use `getServerSession(authOptions)` for auth, which only reads session
cookies. They do **not** work with `Authorization: Bearer` tokens sent by the iOS app.
Each route needs the same mechanical fix: swap `getServerSession` for
`getMiddlewareContext` + `requireAuth`.

**Reference implementation:** `src/app/api/tasks/route.ts` (lines 6-14) — already
migrated and working.

---

## General Pattern

### Route handler — remove:

```typescript
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";

// inside handler:
const session = await getServerSession(authOptions);
if (!session?.user) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
const userId = (session.user as { id?: string })?.id;
if (!userId) {
  return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
}
```

### Route handler — add:

```typescript
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";

// inside handler (use `request` — rename `_request` if needed):
const context = getMiddlewareContext(request);
const userOrResponse = requireAuth(context);
if (userOrResponse instanceof NextResponse) return userOrResponse;
const userId = userOrResponse.id;
```

### Unit tests — remove:

```typescript
import { getServerSession } from "next-auth/next";

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));
```

And any `mockGetServerSession.mockResolvedValue(...)` calls.

### Unit tests — add:

Build requests with middleware headers directly (no mocks needed):

```typescript
// Authenticated:
const headers = new Headers();
headers.set("x-middleware-auth-status", "authenticated");
headers.set("x-middleware-user-id", "user-123");
headers.set("x-middleware-user-email", "test@test.com");
headers.set("x-middleware-user-name", "Test User");
const request = new NextRequest("http://localhost:3000/api/...", { headers });

// Unauthenticated — just omit the headers:
const request = new NextRequest("http://localhost:3000/api/...");
```

### Integration tests — remove:

```typescript
import { getMockedSession, createAuthenticatedSession, mockUnauthenticatedSession } from "...helpers/auth";

// And all per-test calls like:
getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
getMockedSession().mockResolvedValue(mockUnauthenticatedSession());
```

Also remove any file-level `vi.mock("next-auth/next")` blocks if present.

### Integration tests — add:

```typescript
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPostRequest,
  createGetRequest,
  createPostRequest,
} from "@/__tests__/support/helpers/request-builders";
```

Then replace request creation:

```typescript
// Authenticated GET:
const request = createAuthenticatedGetRequest(url, user);

// Authenticated POST:
const request = createAuthenticatedPostRequest(url, user, body);
// or legacy signature: createAuthenticatedPostRequest(url, body, user);

// Unauthenticated (either method) — use plain request, no auth headers:
const request = createGetRequest(url);
const request = createPostRequest(url, body);
```

---

## Route 1: `GET /api/task/[taskId]`

**Route file:** `src/app/api/task/[taskId]/route.ts`

- Lines 2-3: remove `getServerSession` / `authOptions` imports
- Lines 9-17: replace auth block
- The handler param is `_request` — rename to `request` so you can pass it to
  `getMiddlewareContext(request)`

**Unit test:** (none found — skip)

**Integration test:** `src/__tests__/integration/api/task-taskid.test.ts`

- Remove `vi.mock("next-auth/next")` and `vi.mock("@/lib/auth/nextauth")` blocks
- Remove `getMockedSession` / `createAuthenticatedSession` / `mockUnauthenticatedSession` imports
- Add `createAuthenticatedGetRequest` / `createGetRequest` imports from `request-builders`
- Replace all `getMockedSession().mockResolvedValue(createAuthenticatedSession(user))` +
  `createGetRequest(url)` with `createAuthenticatedGetRequest(url, user)`
- Replace all `getMockedSession().mockResolvedValue(mockUnauthenticatedSession())` +
  `createGetRequest(url)` with just `createGetRequest(url)`

---

## Route 2: `GET /api/tasks/[taskId]/messages`

**Route file:** `src/app/api/tasks/[taskId]/messages/route.ts`

- Lines 2-3: remove `getServerSession` / `authOptions` imports
- Lines 15-26: replace auth block
- Handler param is `request` — already named correctly

**Unit test:** `src/__tests__/unit/api/tasks/[taskId]/messages.test.ts`

- Line 4: remove `import { getServerSession } from "next-auth/next"`
- Line 9: remove `vi.mock("next-auth/next", ...)`
- Replace `(getServerSession as vi.Mock).mockResolvedValue(mockSession)` calls with
  middleware headers on the request (see general pattern above)
- Replace `(getServerSession as vi.Mock).mockResolvedValue(null)` with a plain
  `new NextRequest(url)` (no auth headers)

**Integration test:** `src/__tests__/integration/api/tasks-taskid-messages.test.ts`

- Remove `getMockedSession` / `createAuthenticatedSession` / `mockUnauthenticatedSession`
  imports from helpers
- Add `createAuthenticatedGetRequest` / `createGetRequest` imports from `request-builders`
- Replace all 21 `getMockedSession()` calls using the same pattern as Route 1

---

## Route 3: `POST /api/chat/message`

**Route file:** `src/app/api/chat/message/route.ts`

- Line 2: remove `import { getServerSession } from "next-auth/next"`
- Line 3: **keep** `getGithubUsernameAndPAT` but remove `authOptions`:
  ```typescript
  // BEFORE:
  import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
  // AFTER:
  import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
  ```
- Lines 118-126: replace auth block
- Handler param is `request` — already named correctly

**Unit test:** `src/__tests__/unit/api/api-chat-message.test.ts`

- Line 2: remove `import { getServerSession } from "next-auth/next"`
- Line 8: remove `vi.mock("next-auth/next")`
- The mock also needs to remove the dynamic import at ~line 59:
  `const { getServerSession: mockGetServerSession } = await import("next-auth/next")`
- Replace `mockGetServerSession.mockResolvedValue(...)` calls with middleware headers
  on the request
- For authenticated POST, build the request with headers directly:
  ```typescript
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("x-middleware-auth-status", "authenticated");
  headers.set("x-middleware-user-id", userId);
  headers.set("x-middleware-user-email", email);
  headers.set("x-middleware-user-name", name);
  const request = new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers });
  ```

**Integration test:** `src/__tests__/integration/api/chat-message.test.ts`

- Remove `getMockedSession` / `createAuthenticatedSession` / `mockUnauthenticatedSession`
  imports
- Add `createAuthenticatedPostRequest` / `createPostRequest` imports from
  `request-builders`
- Replace all 16 `getMockedSession()` calls:
  - Authenticated: replace `getMockedSession().mockResolvedValue(createAuthenticatedSession(user))`
    + `createPostRequest(url, body)` with `createAuthenticatedPostRequest(url, user, body)`
  - Unauthenticated: replace `getMockedSession().mockResolvedValue(mockUnauthenticatedSession())`
    + `createPostRequest(url, body)` with just `createPostRequest(url, body)`

---

## Route 4: `GET /api/chat/messages/[messageId]`

**Route file:** `src/app/api/chat/messages/[messageId]/route.ts`

- Lines 2-3: remove `getServerSession` / `authOptions` imports
- Lines 14-25: replace auth block
- Handler param is `_request` — rename to `request`

**Unit test:** (none — skip)

**Integration test:** `src/__tests__/integration/api/chat-messages-get.test.ts`

- Remove `getMockedSession` / `createAuthenticatedSession` / `mockUnauthenticatedSession`
  imports
- Add `createAuthenticatedGetRequest` / `createGetRequest` imports from `request-builders`
- Replace all 15 `getMockedSession()` calls using the same pattern as Route 1

---

## Route 5: `GET /api/workspaces/[slug]/tasks/notifications-count`

**Route file:** `src/app/api/workspaces/[slug]/tasks/notifications-count/route.ts`

- Lines 2-3: remove `getServerSession` / `authOptions` imports
- Lines 11-22: replace auth block
- Handler param is `request` — already named correctly

**Unit test:** `src/__tests__/unit/api/workspaces/notifications-count.test.ts`

- Line 3: remove `import { getServerSession } from "next-auth/next"`
- Line 7: remove `vi.mock("next-auth/next", ...)`
- Remove dynamic import at ~line 28:
  `const { getServerSession: mockGetServerSession } = await import("next-auth/next")`
- Replace `mockGetServerSession.mockResolvedValue(...)` calls with middleware headers
  on the request

**Integration test:** `src/__tests__/integration/api/workspaces-notifications-count.test.ts`

- Line 15: remove `vi.mock("next-auth/next")` block
- Remove `getMockedSession` / `createAuthenticatedSession` / `mockUnauthenticatedSession`
  imports from helpers
- Add `createAuthenticatedGetRequest` / `createGetRequest` imports from `request-builders`
- Replace all 7 `getMockedSession()` calls using the same pattern as Route 1

---

## Verify

After each route migration, run:

```bash
# Unit tests
npm run test:unit

# Integration tests (needs Postgres running)
npm run test:integration -- <test-file-name>
```

Specific integration test commands:

```bash
npm run test:integration -- task-taskid
npm run test:integration -- tasks-taskid-messages
npm run test:integration -- chat-message
npm run test:integration -- chat-messages-get
npm run test:integration -- workspaces-notifications-count
```
