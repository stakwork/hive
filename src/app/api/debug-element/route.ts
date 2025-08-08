import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { BugReportContent } from "@/lib/chat";

interface DebugElementRequest {
  bugReportContent: BugReportContent;
  taskId?: string;
}

interface DebugElementResponse {
  success: boolean;
  data?: {
    sourceFiles: Array<{
      file: string;
      lines: number[];
      context?: string;
    }>;
    method: 'click' | 'selection';
    coordinates: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
  error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<DebugElementResponse>> {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Parse request body
    const body: DebugElementRequest = await request.json();
    const { bugReportContent } = body;

    // Validate required fields
    if (!bugReportContent || !bugReportContent.iframeUrl || !bugReportContent.coordinates) {
      return NextResponse.json(
        { success: false, error: "Invalid bug report content" },
        { status: 400 }
      );
    }

    // Validate URL
    try {
      const url = new URL(bugReportContent.iframeUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return NextResponse.json(
          { success: false, error: "Invalid URL protocol" },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid URL format" },
        { status: 400 }
      );
    }

    // Process the BugReportContent from the attachment
    const { coordinates, method, sourceFiles } = bugReportContent;


    // If we have source files from the postMessage, use them; otherwise provide helpful mock data
    const finalSourceFiles = sourceFiles.length > 0 ? sourceFiles : [
      {
        file: "No source files detected",
        lines: [1],
        context: "Target repository may not have debug message listener initialized. Check that initializeDebugMessageListener() is called in the target app."
      }
    ];

    return NextResponse.json({
      success: true,
      data: {
        sourceFiles: finalSourceFiles,
        method,
        coordinates,
        bugDescription: bugReportContent.bugDescription
      }
    });

  } catch (error) {
    console.error('Debug element API error:', error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}