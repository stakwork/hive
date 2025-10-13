import { NextRequest } from "next/server";
export async function POST(request: NextRequest) {
  await request.json();
}
