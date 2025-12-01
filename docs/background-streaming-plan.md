# AI Streaming with Persistent Background Saving - Overview

## The Problem

Next.js API route streams AI responses to the frontend in real-time. When users close the tab or navigate away, the streaming stops and the response is lost. We need to:

1. Stream to the frontend for real-time feedback
2. Continue processing in the background even if the frontend disconnects
3. Save the complete response to the database regardless of client connection
4. Work within Vercel's serverless constraints (timeout limits)

## The Solution: Hybrid Streaming + Background Persistence

### Core Approach

**Stream Teeing**: Split the AI response stream into two independent streams - one for the frontend, one for database processing.

**Next.js 15 `after()`**: Use this function to continue background processing after the response is sent to the client. The background work persists even if the client disconnects.

**Incremental Saves**: Update the database every 200 characters during streaming to minimize data loss if something fails.

**Optimistic DB Creation**: Create a placeholder message record with `SENDING` status before streaming starts, then update it progressively.

### Implementation Notes

**Type Assertions**: The `.tee()` method on ReadableStream returns streams that lose their async iterable typing in TypeScript. We use `as any` type assertions to work around this TypeScript limitation - the streams work correctly at runtime.

**Graceful Client Disconnect**: The frontend stream checks `controller.desiredSize` before enqueuing data to detect when the client has disconnected. All controller operations (`close()`, `error()`) are wrapped in try-catch blocks to handle race conditions where the client disconnects between checking the state and performing the operation. This completely eliminates "Controller is already closed" errors and allows the stream to exit gracefully while the background process continues.

### Key Workflow

1. Create placeholder assistant message in DB (status: `SENDING`)
2. Start AI streaming
3. Use `.tee()` to split the stream into `frontendStream` and `dbStream`
4. Return `frontendStream` to the client immediately
5. Use `after()` to schedule `dbStream` processing in the background
6. Background process reads the stream, saves incrementally, and marks complete

## Expected Behavior

**When user stays on page:**
- Real-time streaming to frontend
- Database updates every 200 characters
- Final save when stream completes

**When user closes tab/navigates away:**
- Frontend stream terminates gracefully
- Background processing continues via `after()`
- Complete response saved to database
- User can return later to see full response

**On error:**
- Partial message saved with ERROR status
- Last incremental save preserved (no data loss)