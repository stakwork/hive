import axios from "axios";
import { generateResponseBasedOnMessage } from "./responses";
import { NextRequest, NextResponse } from "next/server";

export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  try {
    const { message, taskId } = await req.json();

    let simTitle: string | undefined;
    let simDescription: string | undefined;

    try {
      const host = req.headers.get("host") || "localhost:3000";
      const protocol = host.includes("localhost") ? "http" : "https";
      const baseUrl = `${protocol}://${host}`;

      const mockResponse = generateResponseBasedOnMessage(message, baseUrl);

      // Derive a simulated title and description from the input message. In production, this should be done by the LLM from Stakwork's workflow.
      const deriveTitleAndDescription = (msg: string) => {
        const raw = (msg || "").toString().trim();
        const sentence = raw.replace(/\s+/g, " ").slice(0, 400);
        const titleBase = sentence || "Untitled Task";
        const title = (
          titleBase.charAt(0).toUpperCase() + titleBase.slice(1)
        ).slice(0, 50);
        const description = (
          `Auto-generated from user request: ${sentence}. ` +
          "Please review and refine acceptance criteria, scope, and definition of done."
        ).slice(0, 300);
        return { title, description };
      };

      interface HFMessage {
        content?: string;
      }
      interface HFChoice {
        message?: HFMessage;
      }
      interface HFChatResponse {
        choices?: HFChoice[];
      }

      const isTitleDesc = (
        obj: unknown,
      ): obj is { title?: string; description?: string } => {
        if (!obj || typeof obj !== "object") return false;
        const o = obj as Record<string, unknown>;
        const okTitle = o.title === undefined || typeof o.title === "string";
        const okDesc =
          o.description === undefined || typeof o.description === "string";
        return okTitle && okDesc;
      };

      const aiGenerateTitleAndDescription = async (msg: string) => {
        try {
          const hfToken = process.env.HF_ACCESS_TOKEN;
          if (!hfToken) {
            return null;
          }

          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${hfToken}`,
          };

          const hfResponse = await fetch(
            "https://router.huggingface.co/v1/chat/completions",
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                messages: [
                  {
                    role: "user",
                    content: `You are generating metadata for a task created using a chat prompt on the platform hive by stakwork. Based on this user request: "${msg}", return ONLY a strict JSON object with two keys: "title" (<= 60 chars, action-oriented) and "description" (<= 300 chars, 2-3 clear sentences summarizing scope, intent, and success criteria at a high level). Example format: {"title":"...","description":"..."}`,
                  },
                ],
                model: "openai/gpt-oss-120b:novita",
              }),
            },
          );

          if (!hfResponse.ok) return null;
          const hfUnknown = (await hfResponse.json()) as unknown;
          const hfResult = hfUnknown as HFChatResponse;
          const content: string | undefined =
            hfResult?.choices?.[0]?.message?.content;
          if (!content || typeof content !== "string") return null;

          const cleaned = content
            .replace(/^```(json)?/i, "")
            .replace(/```$/i, "")
            .trim();

          let parsed: unknown = null;
          try {
            parsed = JSON.parse(cleaned) as unknown;
          } catch {
            const match = cleaned.match(/\{[\s\S]*\}/);
            if (match) {
              parsed = JSON.parse(match[0]) as unknown;
            }
          }

          if (isTitleDesc(parsed)) {
            return {
              title: parsed.title,
              description: parsed.description,
            };
          }
          return null;
        } catch {
          return null;
        }
      };

      const ai = await aiGenerateTitleAndDescription(message);
      if (ai?.title || ai?.description) {
        const fallback = deriveTitleAndDescription(message);
        simTitle = ai.title || fallback.title;
        simDescription = ai.description || fallback.description;
      } else {
        const { title, description } = deriveTitleAndDescription(message);
        simTitle = title;
        simDescription = description;
      }

      const responsePayload = {
        taskId: taskId,
        message: mockResponse.message,
        contextTags: mockResponse.contextTags,
        sourceWebsocketID: mockResponse.sourceWebsocketID,
        artifacts: mockResponse.artifacts?.map((artifact) => ({
          type: artifact.type,
          content: artifact.content,
        })),
      };

      await axios.post(`${baseUrl}/api/chat/response`, responsePayload);
    } catch (error) {
      console.error("❌ Mock error sending response:", error);
    }

    return NextResponse.json({
      success: true,
      message: "Message received, response will be generated shortly",
      title: simTitle,
      description: simDescription,
    });
  } catch (error) {
    console.error(" Mock error processing message:", error);
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 },
    );
  }
}
