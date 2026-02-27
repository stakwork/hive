import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * In-memory docs state - persists across requests in dev mode
 * Format: { "repo/name": { documentation: string } }
 */
let docsState: Record<string, { documentation: string }> = {
  "stakwork/hive": {
    documentation: `# Hive Platform

## Overview

Hive is an AI-first PM toolkit designed to harden codebases and lift test coverage through automated "janitor" workflows. It combines task management, product planning, AI-powered code analysis, and workspace collaboration with deep GitHub integration and automated pod orchestration.

## Tech Stack

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui
- **Backend**: Next.js API routes, Prisma ORM, PostgreSQL
- **Authentication**: NextAuth.js (GitHub OAuth + GitHub App)
- **State Management**: Zustand (client), TanStack React Query (server)
- **Real-time**: Pusher for live updates
- **Testing**: Vitest (unit/integration), Playwright (E2E)
- **Security**: AES-256-GCM field-level encryption for sensitive data

## Key Features

- Task management with dual status system (user vs workflow)
- AI-powered janitor workflows for code quality
- Product planning with Features, Phases, and User Stories
- Deep GitHub integration via GitHub App
- Automated pod orchestration for AI workloads
- Real-time collaboration with Pusher
- Comprehensive permission system with role-based access

## Getting Started

1. Install dependencies: \`npm install\`
2. Set up environment variables (see \`env.example\`)
3. Run database migrations: \`npx prisma migrate dev\`
4. Start development server: \`npm run dev\`

## Architecture

The application follows a hierarchical structure:
- Users/Auth → Source Control → Workspaces → Tasks/Janitors/Features

For detailed architecture documentation, see the repository README.
`,
  },
};

/**
 * Mock Stakgraph Docs Endpoint
 *
 * GET - Returns all docs keyed by repo name
 * PUT - Updates documentation for a specific repo
 */
export async function GET(request: NextRequest) {
  try {
    // Auth validation
    const apiToken = request.headers.get("x-api-token");

    if (!apiToken) {
      return NextResponse.json(
        { error: "Missing x-api-token header" },
        { status: 401 }
      );
    }

    // Return array format: [{ "repo/name": { documentation: "..." } }]
    const docsArray = [docsState];

    console.log(`[StakgraphMock] GET /docs - returning ${Object.keys(docsState).length} repos`);

    return NextResponse.json(docsArray);
  } catch (error) {
    console.error("[StakgraphMock] GET /docs error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve docs" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Auth validation
    const apiToken = request.headers.get("x-api-token");

    if (!apiToken) {
      return NextResponse.json(
        { error: "Missing x-api-token header" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { repo, documentation } = body;

    if (!repo || !documentation) {
      return NextResponse.json(
        { error: "repo and documentation are required" },
        { status: 400 }
      );
    }

    // Update in-memory state
    docsState[repo] = { documentation };

    console.log(`[StakgraphMock] PUT /docs - updated repo: ${repo}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[StakgraphMock] PUT /docs error:", error);
    return NextResponse.json(
      { error: "Failed to update docs" },
      { status: 500 }
    );
  }
}
