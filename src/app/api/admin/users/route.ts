import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const users = await db.user.findMany({
      where: { role: "SUPER_ADMIN" },
      select: {
        id: true,
        name: true,
        email: true,
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ users });
  } catch (error) {
    console.error("Error fetching superadmins:", error);
    return NextResponse.json(
      { error: "Failed to fetch superadmins" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const body = await request.json();
    const { email, userId } = body;

    // Support both email and userId for flexibility
    const whereClause = email ? { email } : userId ? { id: userId } : null;

    if (!whereClause) {
      return NextResponse.json(
        { error: "Either email or userId is required" },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({
      where: whereClause,
      select: { id: true, role: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.role === "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "User is already a superadmin" },
        { status: 400 }
      );
    }

    await db.user.update({
      where: { id: user.id },
      data: { role: "SUPER_ADMIN" },
    });

    return NextResponse.json({
      success: true,
      message: "User promoted to superadmin",
    });
  } catch (error) {
    console.error("Error promoting user:", error);
    return NextResponse.json(
      { error: "Failed to promote user" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    // Prevent self-demotion
    if (authResult.userId === userId) {
      return NextResponse.json(
        { error: "Cannot demote yourself" },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "User is not a superadmin" },
        { status: 400 }
      );
    }

    await db.user.update({
      where: { id: userId },
      data: { role: "USER" },
    });

    return NextResponse.json({
      success: true,
      message: "Superadmin status revoked",
    });
  } catch (error) {
    console.error("Error revoking superadmin:", error);
    return NextResponse.json(
      { error: "Failed to revoke superadmin" },
      { status: 500 }
    );
  }
}
