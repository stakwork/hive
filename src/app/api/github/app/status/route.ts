import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { getUserAppTokens } from "@/lib/githubApp";
// import { EncryptionService } from "@/lib/encryption";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ hasTokens: false }, { status: 200 });
    }

    // Check if user has GitHub App tokens
    const apptokens = await getUserAppTokens(session.user.id);
    const hasTokens = !!apptokens?.accessToken;

    // if (hasTokens) {
    //   const encryptionService = EncryptionService.getInstance();
    //   const accessToken = encryptionService.decryptField("app_access_token", apptokens.accessToken as string);
    //   console.log("=> accessToken", accessToken);
    // }

    return NextResponse.json({ hasTokens }, { status: 200 });
  } catch (error) {
    console.error("Failed to check GitHub App status", error);
    return NextResponse.json({ hasTokens: false }, { status: 200 });
  }
}
