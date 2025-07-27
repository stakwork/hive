import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";

interface DebugElementRequest {
  x: number;
  y: number;
  width: number;
  height: number;
  iframeUrl: string;
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
    const { x, y, width, height, iframeUrl, taskId } = body;

    // Validate required fields
    if (typeof x !== 'number' || typeof y !== 'number' || 
        typeof width !== 'number' || typeof height !== 'number' || 
        !iframeUrl) {
      return NextResponse.json(
        { success: false, error: "Invalid request parameters" },
        { status: 400 }
      );
    }

    // Validate URL
    try {
      const url = new URL(iframeUrl);
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

    // TODO: Implement actual DOM extraction logic
    // For now, return mock data to test the integration
    const mockSourceFiles = [
      {
        file: "src/components/HomePage.tsx",
        lines: [42, 43, 44],
        context: "Button component with onClick handler"
      },
      {
        file: "src/styles/homepage.css",
        lines: [15],
        context: ".hero-button styling"
      }
    ];

    const method = width === 0 && height === 0 ? 'click' : 'selection';

    console.log(`Debug element request: ${method} at (${x}, ${y}) ${width}x${height} on ${iframeUrl} for task ${taskId}`);

    return NextResponse.json({
      success: true,
      data: {
        sourceFiles: mockSourceFiles,
        method,
        coordinates: { x, y, width, height }
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