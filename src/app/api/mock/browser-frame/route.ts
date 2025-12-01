import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Mock browser frame endpoint for E2E testing
 * Returns an HTML page that simulates a pod with staktrak initialized
 * Sends the "staktrak-setup" message to parent window to enable recorder buttons
 */
export async function GET() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mock Pod Frame</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    h1 {
      font-size: 2rem;
      margin-bottom: 1rem;
    }
    p {
      opacity: 0.9;
      margin-bottom: 0.5rem;
    }
    .status {
      margin-top: 1.5rem;
      padding: 1rem;
      background: rgba(255,255,255,0.1);
      border-radius: 8px;
    }
    .status-item {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      margin: 0.5rem 0;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #4ade80;
    }
    button {
      margin-top: 1rem;
      padding: 0.75rem 1.5rem;
      background: white;
      color: #764ba2;
      border: none;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
    }
    button:hover {
      transform: scale(1.05);
    }
    .actions {
      margin-top: 2rem;
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Mock Development Pod</h1>
    <p>This is a simulated pod environment for E2E testing</p>
    <p>Staktrak recorder integration is enabled</p>

    <div class="status">
      <div class="status-item">
        <span class="dot"></span>
        <span>Staktrak: Connected</span>
      </div>
      <div class="status-item">
        <span class="dot"></span>
        <span>Recorder: Ready</span>
      </div>
    </div>

    <div class="actions">
      <button onclick="handleClick('primary')">Primary Action</button>
      <button onclick="handleClick('secondary')">Secondary Action</button>
    </div>
  </div>

  <script>
    // Send staktrak-setup message to parent window
    // This enables the recorder buttons in the browser artifact panel
    window.parent.postMessage({ type: "staktrak-setup" }, "*");

    // Log for debugging
    console.log("[Mock Pod] Sent staktrak-setup message to parent");

    // Handle messages from parent (recording commands, etc.)
    window.addEventListener("message", (event) => {
      console.log("[Mock Pod] Received message:", event.data);

      // Respond to staktrak commands with mock responses
      if (event.data?.type === "staktrak-start-recording") {
        console.log("[Mock Pod] Recording started");
      }
      if (event.data?.type === "staktrak-stop-recording") {
        console.log("[Mock Pod] Recording stopped");
      }
    });

    // Mock click handler for testing interactions
    function handleClick(action) {
      console.log("[Mock Pod] Button clicked:", action);
      // In a real staktrak scenario, this would be captured as an action
    }
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html",
    },
  });
}
