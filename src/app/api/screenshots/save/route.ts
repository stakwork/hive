import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import path from "path";

/**
 * Screenshot Capture API
 * Saves base64-encoded screenshots captured during user journey replay.
 * Screenshots are stored in public/screenshots/ and served as static assets.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dataUrl, timestamp, randomId, url, actionIndex } = body;

    // Validate required fields
    if (!dataUrl || !timestamp || !randomId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Extract base64 data from data URL
    const matches = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      return NextResponse.json({ error: "Invalid data URL format" }, { status: 400 });
    }

    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, "base64");

    // Generate filename: {timestamp}-{randomId}.jpg
    const filename = `${timestamp}-${randomId}.jpg`;
    const filepath = path.join(process.cwd(), "public", "screenshots", filename);

    // Save file to public/screenshots
    await writeFile(filepath, buffer);

    // Return the public path
    const publicPath = `/screenshots/${filename}`;

    return NextResponse.json({
      success: true,
      filePath: publicPath,
      filename,
      url,
      actionIndex,
      timestamp,
    });
  } catch (error) {
    console.error("Error saving screenshot:", error);
    return NextResponse.json(
      { error: "Failed to save screenshot", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
