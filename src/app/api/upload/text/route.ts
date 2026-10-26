import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { isTextAttachment } from "@/lib/ai/attachmentParts";
import { canReadKey } from "@/lib/ai/resolveMessageAttachments";
import { getS3Service } from "@/services/s3";

/** Enough for any transcript or note; the download has the rest. */
const TEXT_CHAR_CAP = 200_000;

/**
 * GET /api/upload/text?s3Key=… — a text attachment's contents, for the chat
 * to show in place (`SidebarChatMessage`'s text viewer).
 *
 * Why not the presigned link: opened as a page of its own, the bucket's
 * host (`hive-sphinx-chat.s3…amazonaws.com`) trips Chrome's lookalike-domain
 * warning for `sphinx.chat`. This answers on Hive's own origin, as JSON —
 * never as a document, so nothing in an uploaded file can run here.
 *
 * Same access rule as `GET /api/upload/presigned-url` (`canReadKey`): a key
 * the caller cannot read is a 404. Only text files: anything else is 415.
 */
export async function GET(request: NextRequest) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const s3Key = request.nextUrl.searchParams.get("s3Key");
  if (!s3Key) {
    return NextResponse.json({ error: "s3Key parameter is required" }, { status: 400 });
  }
  if (!(await canReadKey(s3Key, userOrResponse.id))) {
    return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 });
  }
  const filename = s3Key.split("/").pop() ?? "";
  if (!isTextAttachment({ path: s3Key, filename, mimeType: "", size: 0 })) {
    return NextResponse.json({ error: "Not a text file" }, { status: 415 });
  }

  try {
    const body = (await getS3Service().getObject(s3Key)).toString("utf8");
    const truncated = body.length > TEXT_CHAR_CAP;
    return NextResponse.json(
      { text: truncated ? body.slice(0, TEXT_CHAR_CAP) : body, truncated },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[upload/text] read failed:", error);
    return NextResponse.json({ error: "Could not read the file" }, { status: 500 });
  }
}
