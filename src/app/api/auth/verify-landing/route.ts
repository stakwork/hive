import { NextRequest, NextResponse } from "next/server";
import {
  signCookie,
  constantTimeCompare,
  LANDING_COOKIE_NAME,
  LANDING_COOKIE_MAX_AGE,
} from "@/lib/auth/landing-cookie";
import { badRequest, unauthorized } from "@/types/errors";
import { handleApiError } from "@/lib/api/errors";

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    const landingPassword = process.env.LANDING_PAGE_PASSWORD;
    if (!landingPassword || landingPassword.trim() === "") {
      throw badRequest("Landing page password is not enabled");
    }

    if (!password || typeof password !== "string") {
      throw badRequest("Password is required");
    }

    const isValid = constantTimeCompare(password, landingPassword);

    if (!isValid) {
      throw unauthorized("Incorrect password");
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
    return handleApiError(error);
  }
}
