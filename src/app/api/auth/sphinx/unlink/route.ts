import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function DELETE() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await db.$transaction(async (tx) => {
      // Clear lightningPubkey from user
      await tx.user.update({
        where: { id: session.user.id },
        data: { lightningPubkey: null },
      });
      
      // Delete sphinx account record
      await tx.account.deleteMany({
        where: {
          userId: session.user.id,
          provider: "sphinx",
        },
      });
    });

    logger.info("Sphinx account unlinked", "SPHINX_AUTH", { 
      userId: session.user.id 
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Error unlinking Sphinx account", "SPHINX_AUTH", { error });
    return NextResponse.json(
      { error: "Failed to unlink account" },
      { status: 500 }
    );
  }
}
