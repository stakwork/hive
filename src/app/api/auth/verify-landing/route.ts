import { NextRequest, NextResponse } from "next/server";
import {
  signCookie,
  constantTimeCompare,
  LANDING_COOKIE_NAME,
  LANDING_COOKIE_MAX_AGE,
} from "@/lib/auth/landing-cookie";

export async function POST(request: NextRequest) {
  try {
    let password = "";
    try {
      const body = await request.json();
      password = body.password;
    } catch (error) {
      return NextResponse.json({ success: false, message: "Invalid or missing JSON body" }, { status: 400 });
    }

    // Check if landing page password is set
    const landingPassword = process.env.LANDING_PAGE_PASSWORD;
    if (!landingPassword || landingPassword.trim() === "") {
      return NextResponse.json({ success: false, message: "Landing page password is not enabled" }, { status: 400 });
    }

    // Validate password input
    if (!password || typeof password !== "string") {
      return NextResponse.json({ success: false, message: "Password is required" }, { status: 400 });
    }

    // Use constant-time comparison to prevent timing attacks
    const isValid = constantTimeCompare(password, landingPassword);

    if (!isValid) {
      return NextResponse.json({ success: false, message: "Incorrect password" }, { status: 401 });
    }

    // Password correct - set signed verification cookie
    const timestamp = Date.now().toString();
    const signedValue = await signCookie(timestamp);

    const response = NextResponse.json({ success: true, message: "Access granted" });

    response.cookies.set(LANDING_COOKIE_NAME, signedValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: LANDING_COOKIE_MAX_AGE,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Error verifying landing page password:", error);
    return NextResponse.json({ success: false, message: "An error occurred" }, { status: 500 });
  }
}
