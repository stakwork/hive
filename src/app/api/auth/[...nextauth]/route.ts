import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";

// To permit Edge Runtime, we need to set the runtime to nodejs
export const runtime = "nodejs";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
