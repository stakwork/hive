import { db } from "@/lib/db";
import { ArtifactType } from "@prisma/client";
import type { Deck } from "./types";

export interface BuildDeckPod {
  controlUrl?: string;
  password?: string;
  appUrl?: string;
}

function resolveAppUrl(pod?: BuildDeckPod): string {
  return (
    process.env.CUSTOM_STAKLINK_URL ||
    process.env.VERIFY_APP_URL ||
    pod?.appUrl ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000"
  );
}

function renderFeatureContext(feature: {
  title: string;
  brief: string | null;
  requirements: string | null;
  architecture: string | null;
  personas: string[];
  userStories: { title: string }[];
}): string {
  const sections: string[] = [
    "=== CONTEXT ONLY — background for understanding the task, NOT part of what is being audited ===",
    `Feature: ${feature.title}`,
  ];

  if (feature.brief) sections.push(`Brief:\n${feature.brief}`);
  if (feature.requirements) sections.push(`Requirements:\n${feature.requirements}`);
  if (feature.architecture) sections.push(`Architecture:\n${feature.architecture}`);
  if (feature.personas.length > 0) sections.push(`Personas:\n${feature.personas.map((p) => `- ${p}`).join("\n")}`);
  if (feature.userStories.length > 0) {
    sections.push(`User Stories:\n${feature.userStories.map((s) => `- ${s.title}`).join("\n")}`);
  }

  sections.push("=== END CONTEXT ONLY ===");
  return sections.join("\n\n");
}

async function loadDiffFromArtifacts(taskId: string): Promise<string | null> {
  const message = await db.chatMessage.findFirst({
    where: {
      taskId,
      artifacts: { some: { type: ArtifactType.DIFF } },
    },
    orderBy: { createdAt: "desc" },
    select: {
      artifacts: {
        where: { type: ArtifactType.DIFF },
        select: { content: true },
      },
    },
  });

  const content = message?.artifacts[0]?.content;
  if (!content) return null;

  return JSON.stringify(content);
}

async function loadDiffFromPod(pod?: BuildDeckPod): Promise<string | null> {
  if (!pod?.controlUrl) return null;

  const headers: Record<string, string> = {};
  if (pod.password) headers.Authorization = `Bearer ${pod.password}`;

  try {
    const response = await fetch(`${pod.controlUrl}/diff`, { method: "GET", headers });
    if (!response.ok) {
      console.error(`[auditor:deck] Failed to fetch diff from pod: ${response.status}`);
      return null;
    }
    const diffs = await response.json();
    return JSON.stringify(diffs);
  } catch (error) {
    console.error("[auditor:deck] Error fetching diff from pod:", error);
    return null;
  }
}

export async function buildDeck(taskId: string, pod?: BuildDeckPod): Promise<Deck> {
  const task = await db.task.findUnique({
    where: { id: taskId, deleted: false },
    select: {
      title: true,
      description: true,
      feature: {
        select: {
          title: true,
          brief: true,
          requirements: true,
          architecture: true,
          personas: true,
          userStories: {
            orderBy: { order: "asc" },
            select: { title: true },
          },
        },
      },
    },
  });

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const diff = (await loadDiffFromArtifacts(taskId)) ?? (await loadDiffFromPod(pod)) ?? "";

  const featureContext = task.feature ? renderFeatureContext(task.feature) : "";

  return {
    task: {
      prompt: task.title,
      description: task.description ?? "",
    },
    diff,
    featureContext,
    map: {
      appUrl: resolveAppUrl(pod),
      notes: null,
    },
  };
}
