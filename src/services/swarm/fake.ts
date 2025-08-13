import { NextRequest, NextResponse } from "next/server";
import { isSwarmFakeModeEnabled } from "@/lib/runtime";

export const isFakeMode = isSwarmFakeModeEnabled();

// In-memory fake swarms: { [name: string]: { id, swarm_id, status, pollCount } }
const fakeSwarms: Record<
  string,
  { id: string; swarm_id: string; status: string; pollCount: number }
> = {};

function makeId(prefix: string = "fake") {
  return `${prefix}-${Math.random().toString(36).substr(2, 8)}`;
}

export async function createFakeSwarm() {
  const id = makeId("id");
  const swarm_id = makeId("swarmid");
  fakeSwarms[id] = { id, swarm_id, status: "PENDING", pollCount: 0 };
  return { id, swarm_id };
}

export async function fakePollSwarm(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id || !fakeSwarms[id]) {
    return NextResponse.json(
      { success: false, message: "Swarm not found (FAKE)" },
      { status: 404 },
    );
  }
  const fake = fakeSwarms[id];
  fake.pollCount++;
  // Simulate transition: after 3 polls, mark as ACTIVE
  if (fake.pollCount >= 3) {
    fake.status = "ACTIVE";
  }
  return NextResponse.json({
    success: true,
    status: fake.status,
    details: { message: `This is a fake swarm. Poll count: ${fake.pollCount}` },
  });
}
