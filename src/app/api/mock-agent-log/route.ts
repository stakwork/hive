import { NextResponse } from "next/server";

export async function GET() {
  const mockLog = [
    {
      role: "user",
      content: "Please run some shell commands to check the system"
    },
    {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "tc1", toolName: "developer__shell", input: { command: "ls -la /workspaces" } },
        { type: "tool-call", toolCallId: "tc2", toolName: "developer__shell", input: { command: "git status" } },
        { type: "tool-call", toolCallId: "tc3", toolName: "developer__shell", input: { command: "ls /tmp" } },
        { type: "tool-call", toolCallId: "tc4", toolName: "developer__shell", input: { command: "git log --oneline -5" } },
        { type: "tool-call", toolCallId: "tc5", toolName: "developer__shell", input: { command: "npm run test:unit" } },
        { type: "tool-call", toolCallId: "tc6", toolName: "developer__shell", input: { command: "git diff HEAD" } },
        { type: "tool-call", toolCallId: "tc7", toolName: "developer__text_editor", input: { command: "view", path: "/workspaces/hive/src" } },
        { type: "tool-call", toolCallId: "tc8", toolName: "developer__text_editor", input: { command: "str_replace", path: "/workspaces/hive/src/index.ts" } }
      ]
    },
    {
      role: "tool",
      content: [
        { type: "tool-result", toolCallId: "tc1", output: { type: "text", value: "drwxr-xr-x hive" } },
        { type: "tool-result", toolCallId: "tc2", output: { type: "text", value: "On branch main" } },
        { type: "tool-result", toolCallId: "tc3", output: { type: "text", value: "drwxr-xr-x tmp" } },
        { type: "tool-result", toolCallId: "tc4", output: { type: "text", value: "abc123 fix: update" } },
        { type: "tool-result", toolCallId: "tc5", output: { type: "text", value: "Tests passed" } },
        { type: "tool-result", toolCallId: "tc6", output: { type: "text", value: "diff --git a/src..." } },
        { type: "tool-result", toolCallId: "tc7", output: { type: "text", value: "src directory" } },
        { type: "tool-result", toolCallId: "tc8", output: { type: "text", value: "replaced" } }
      ]
    },
    {
      role: "assistant",
      content: "Done! I ran several shell commands and edited files."
    }
  ];
  return NextResponse.json(mockLog);
}
