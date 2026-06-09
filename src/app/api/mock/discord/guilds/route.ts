import { NextResponse } from "next/server";

export async function GET() {
  if (process.env.USE_MOCKS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    guilds: [
      {
        id: "111",
        name: "Hive Dev Server",
        channels: [
          { id: "222", name: "general", type: 0 },
          { id: "333", name: "engineering", type: 0 },
          { id: "444", name: "feature-threads", type: 11 },
          { id: "555", name: "support-forum", type: 15 },
        ],
      },
    ],
  });
}
