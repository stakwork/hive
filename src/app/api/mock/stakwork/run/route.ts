import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";
import { repoAgent } from "@/lib/ai/askTools";

const STAKWORK_WORKSPACE_ID = "cmh4vrcj70001id04idolu9br";

export async function POST(request: NextRequest) {
  let run: { id: string } | null = null;
  let webhookUrl: string | undefined;

  try {
    const body = await request.json();
    const vars = body?.workflow_params?.set_var?.attributes?.vars ?? {};

    const { webhookUrl: wh, swarmUrl, swarmApiKey, repo_url, prompt } = vars as Record<string, string>;
    webhookUrl = wh;

    const missing = (["webhookUrl", "swarmUrl", "swarmApiKey", "repo_url", "prompt"] as const).filter(
      (k) => !vars[k]
    );
    if (missing.length > 0) {
      return NextResponse.json(
        { success: false, error: `Missing required fields: ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    const workspaceId = (vars.workspaceId as string | undefined) ?? STAKWORK_WORKSPACE_ID;

    run = await db.stakwork_runs.create({
      data: {
        id: randomUUID(),
        type: StakworkRunType.REPO_AGENT,
        status: WorkflowStatus.IN_PROGRESS,
        webhook_url: webhookUrl,
        workspace_id: workspaceId,
        updated_at: new Date(),
      },
      select: { id: true },
    });

    const agentResult = await repoAgent(swarmUrl, swarmApiKey, {
      repo_url,
      prompt,
      pat: vars.pat as string | undefined,
      username: vars.username as string | undefined,
      commit: vars.commit as string | undefined,
      branch: vars.branch as string | undefined,
      toolsConfig: vars.toolsConfig,
      jsonSchema: vars.jsonSchema as Record<string, unknown> | undefined,
      model: vars.model as string | undefined,
      skills: vars.skills as Record<string, boolean> | undefined,
      subAgents: vars.subAgents as import("@/lib/ai/askTools").SubAgent[] | undefined,
    });

    await db.stakwork_runs.update({
      where: { id: run.id },
      data: {
        status: WorkflowStatus.COMPLETED,
        result: JSON.stringify(agentResult),
        updated_at: new Date(),
      },
    });

    await fetch(`${webhookUrl}?run_id=${run.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_status: "complete", project_id: null }),
    });

    return NextResponse.json({ success: true, run_id: run.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (run) {
      await db.stakwork_runs.update({
        where: { id: run.id },
        data: { status: WorkflowStatus.FAILED, updated_at: new Date() },
      });

      if (webhookUrl) {
        await fetch(`${webhookUrl}?run_id=${run.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_status: "failed", project_id: null }),
        }).catch(() => {});
      }
    }

    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
