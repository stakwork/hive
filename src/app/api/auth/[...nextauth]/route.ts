import { handlers } from "@/auth";

// To permit Edge Runtime, we need to set the runtime to nodejs
export const runtime = "nodejs";

export const { GET, POST } = handlers;
