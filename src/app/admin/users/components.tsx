"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export function PromoteSuperadminForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function handlePromote(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to promote user");
      }

      toast.success("User promoted to superadmin");
      setEmail("");
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to promote user");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handlePromote} className="flex gap-2">
      <Input
        type="email"
        placeholder="user@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={loading}
      />
      <Button type="submit" disabled={loading || !email}>
        {loading ? "Promoting..." : "Promote"}
      </Button>
    </form>
  );
}

export function RevokeSuperadminButton({ userId, userName }: { userId: string; userName: string | null }) {
  const [loading, setLoading] = useState(false);

  async function handleRevoke() {
    if (!confirm(`Are you sure you want to revoke superadmin access from ${userName || "this user"}?`)) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to revoke access");
      }

      toast.success("Superadmin access revoked");
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to revoke access");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={handleRevoke}
      disabled={loading}
    >
      {loading ? "Revoking..." : "Revoke"}
    </Button>
  );
}
