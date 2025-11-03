import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validatePassword } from "@/lib/utils/password";
import bcrypt from "bcryptjs";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized - please sign in" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    // Validate required fields
    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { success: false, error: "Current password and new password are required" },
        { status: 400 }
      );
    }

    // Validate new password complexity
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      return NextResponse.json(
        { 
          success: false, 
          error: passwordValidation.message || "New password does not meet complexity requirements" 
        },
        { status: 400 }
      );
    }

    // Fetch user with current password
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        passwordDigest: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    // Check if user has a password set (OAuth-only users won't have one)
    if (!user.passwordDigest) {
      return NextResponse.json(
        { 
          success: false, 
          error: "No password set. Please use 'Set Password' instead of 'Change Password'" 
        },
        { status: 400 }
      );
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.passwordDigest
    );

    if (!isCurrentPasswordValid) {
      return NextResponse.json(
        { success: false, error: "Current password is incorrect" },
        { status: 400 }
      );
    }

    // Ensure new password is different from current
    const isSamePassword = await bcrypt.compare(newPassword, user.passwordDigest);
    if (isSamePassword) {
      return NextResponse.json(
        { success: false, error: "New password must be different from current password" },
        { status: 400 }
      );
    }

    // Hash new password
    const newPasswordDigest = await bcrypt.hash(newPassword, 10);

    // Update user password
    await db.user.update({
      where: { id: user.id },
      data: {
        passwordDigest: newPasswordDigest,
        passwordUpdatedAt: new Date(),
      },
    });

    logger.authInfo("Password changed successfully", "PASSWORD_CHANGE_SUCCESS", {
      userId: user.id,
      email: user.email,
    });

    return NextResponse.json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    logger.authError("Password change failed", "PASSWORD_CHANGE_ERROR", error);
    return NextResponse.json(
      { success: false, error: "Internal server error during password change" },
      { status: 500 }
    );
  }
}