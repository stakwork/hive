import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const CANNED_SUMMARY = `## Workflow Changes Summary

### Version Comparison

**3 versions compared**

- **Step added**: \`summarise_output\` step introduced in v2 to post-process LLM results before returning
- **Prompt modified**: System prompt in \`generate_response\` updated to include chain-of-thought instructions
- **Variable renamed**: \`api_key\` renamed to \`token_reference\` for consistency with other workflows

### Overall trend
This workflow has been progressively hardened with better prompt engineering and output validation.`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const vars = body?.workflow_params?.set_var?.attributes?.vars ?? {};
    const { callback_url: callbackUrl } = vars;

    // Respond immediately with a mock project_id
    const response = NextResponse.json({ success: true, data: { project_id: 99999 } }, { status: 200 });

    // Asynchronously POST canned summary to the callback URL
    if (callbackUrl) {
      setImmediate(async () => {
        try {
          await fetch(callbackUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-token": process.env.API_TOKEN ?? "",
            },
            body: JSON.stringify({ content: CANNED_SUMMARY, status: "complete" }),
          });
        } catch (err) {
          console.error("[Mock Workflow Summarise] Failed to POST to callback_url:", err);
        }
      });
    }

    return response;
  } catch (error) {
    console.error("[Mock Workflow Summarise] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
