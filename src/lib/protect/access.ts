import { NextResponse } from "next/server";
import {
  requireMemberAccess,
  type WorkspaceAccess,
} from "@/lib/auth/workspace-access";

export function requireProtectMemberAccess(access: WorkspaceAccess) {
  if (access.kind === "public-viewer") {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  return requireMemberAccess(access);
}
