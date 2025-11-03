import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validatePassword } from "@/lib/utils/password";
import bcrypt from "bcryptjs";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, name } = body;

    // Validate required fields
    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, error: "Invalid email format" },
        { status: 400 }
      );
    }

    // Validate password complexity
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return NextResponse.json(
        { 
          success: false, 
          error: passwordValidation.message || "Password does not meet complexity requirements" 
        },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await db.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { success: false, error: "User with this email already exists" },
        { status: 409 }
      );
    }

    // Hash password with bcrypt (default 10 salt rounds)
    const passwordDigest = await bcrypt.hash(password, 10);

    // Create user with hashed password
    const user = await db.user.create({
      data: {
        email,
        name: name || email.split("@")[0], // Use email prefix as default name
        passwordDigest,
        passwordUpdatedAt: new Date(),
        emailVerified: null, // Email verification can be added in future
        role: "USER",
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });

    logger.authInfo("User registered with password", "REGISTER_SUCCESS", {
      userId: user.id,
      email: user.email,
    });

    return NextResponse.json(
      {
        success: true,
        message: "User registered successfully",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.authError("User registration failed", "REGISTER_ERROR", error);
    return NextResponse.json(
      { success: false, error: "Internal server error during registration" },
      { status: 500 }
    );
  }
}