import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      inputs: {
        param1: "value1",
        model: "gpt-4o",
        prompt: "Summarise the following...",
      },
      outputs: {
        content: "Generated text result",
        status: "ok",
        tokens_used: 312,
      },
    },
  });
}
