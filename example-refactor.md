# Auth Middleware Helper Examples

## Before (Current Pattern - 97 lines)

```typescript
// /src/app/api/workspaces/[slug]/janitors/config/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { z } from "zod";
import { getOrCreateJanitorConfig, updateJanitorConfig } from "@/services/janitor";

const updateJanitorConfigSchema = z.object({
  unitTestsEnabled: z.boolean().optional(),
  integrationTestsEnabled: z.boolean().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const config = await getOrCreateJanitorConfig(slug, userId);

    return NextResponse.json({ config });
  } catch (error) {
    console.error("Error fetching janitor config:", error);
    
    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const body = await request.json();
    const validatedData = updateJanitorConfigSchema.parse(body);

    const config = await updateJanitorConfig(slug, userId, validatedData);

    return NextResponse.json({ 
      success: true,
      config 
    });
  } catch (error) {
    console.error("Error updating janitor config:", error);
    
    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    if (error instanceof Error) {
      if (error.message.includes("not found")) {
        return NextResponse.json(
          { error: "Workspace not found or access denied" },
          { status: 404 }
        );
      }
      if (error.message.includes("Insufficient permissions")) {
        return NextResponse.json(
          { error: "Insufficient permissions" },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

## After (With Helpers - 34 lines)

```typescript
// /src/app/api/workspaces/[slug]/janitors/config/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth } from "@/lib/auth/middleware";
import { getOrCreateJanitorConfig, updateJanitorConfig } from "@/services/janitor";

const updateJanitorConfigSchema = z.object({
  unitTestsEnabled: z.boolean().optional(),
  integrationTestsEnabled: z.boolean().optional(),
});

export const GET = withWorkspaceAuth(async ({ userId, slug }) => {
  const config = await getOrCreateJanitorConfig(slug, userId);
  return NextResponse.json({ config });
});

export const PUT = withWorkspaceAuth(async ({ userId, slug }, request) => {
  const body = await request.json();
  const validatedData = updateJanitorConfigSchema.parse(body);
  const config = await updateJanitorConfig(slug, userId, validatedData);
  
  return NextResponse.json({ 
    success: true,
    config 
  });
});
```

## Reduction

- **97 lines → 34 lines** (65% reduction)
- **Eliminated boilerplate**: Session management, error handling, workspace validation
- **Consistent error responses** across all routes
- **Type-safe parameters** provided automatically

## Alternative Individual Helper Pattern

```typescript
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { userId } = await requireAuth();
    const { slug } = await params;
    await requireWorkspaceAccess(slug, userId); // Validates access automatically
    
    const config = await getOrCreateJanitorConfig(slug, userId);
    return NextResponse.json({ config });
  } catch (error) {
    return handleAuthError(error);
  }
}
```

This provides more granular control while still eliminating most boilerplate.