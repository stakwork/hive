"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Laptop, Loader2 } from "lucide-react";
import { toast } from "sonner";

type PairingStatus = "pending" | "approved" | "denied" | "expired" | "consumed";

interface PairingLookup {
  pairing: {
    userCode: string;
    deviceName: string;
    expiresAt: string;
    status: PairingStatus;
    decidedByYou: boolean;
  };
  orgs: { githubLogin: string; name: string }[];
}

/** Look up a pairing by its code, then approve or deny it (`/api/strut-devices/pair/approve`). */
export function PairDevice({ initialCode }: { initialCode: string }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [lookup, setLookup] = useState<PairingLookup | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [acting, setActing] = useState<"approve" | "deny" | null>(null);

  const find = useCallback(
    async (value: string) => {
      if (!value.trim()) return;
      setLoading(true);
      setNotFound(false);
      try {
        const res = await fetch(`/api/strut-devices/pair/approve?code=${encodeURIComponent(value.trim())}`);
        if (res.status === 404) {
          setLookup(null);
          setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error();
        const found = (await res.json()) as PairingLookup;
        setLookup(found);
        router.replace(`/pair?code=${found.pairing.userCode}`);
      } catch {
        toast.error("Could not look up that code");
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    if (initialCode) find(initialCode);
  }, [initialCode, find]);

  const decide = async (action: "approve" | "deny") => {
    if (!lookup) return;
    setActing(action);
    try {
      const res = await fetch("/api/strut-devices/pair/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: lookup.pairing.userCode, action }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Could not record your answer");
      }
      await find(lookup.pairing.userCode);
    } finally {
      setActing(null);
    }
  };

  const pairing = lookup?.pairing;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Laptop className="h-5 w-5" />
          Connect a device to strut
        </CardTitle>
        <CardDescription>
          A strut desktop app pairs with your account to reach your orgs&apos; strut as you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!pairing || pairing.status === "expired" ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              find(code);
            }}
          >
            {pairing?.status === "expired" && (
              <p className="text-sm text-muted-foreground">This code has expired. Start pairing again on the device.</p>
            )}
            <Label htmlFor="pair-code">Code shown on your device</Label>
            <div className="flex gap-2">
              <Input
                id="pair-code"
                placeholder="BCDF-GHJK"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                className="font-mono uppercase"
              />
              <Button type="submit" disabled={loading || !code.trim()}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
              </Button>
            </div>
            {notFound && <p className="text-sm text-destructive">No pairing with that code. Check the code on the device.</p>}
          </form>
        ) : pairing.status === "pending" ? (
          <div className="space-y-4">
            <p className="text-sm">
              <span className="font-medium">{pairing.deviceName}</span> asks to connect to strut as you. Make sure the
              device shows this code:
            </p>
            <p className="text-center font-mono text-2xl tracking-widest">{pairing.userCode}</p>
            {lookup.orgs.length > 0 ? (
              <div className="text-sm">
                <p>It will get a token for the strut of each of your orgs, renewed daily until you revoke it in Settings:</p>
                <ul className="mt-2 list-disc pl-5">
                  {lookup.orgs.map((org) => (
                    <li key={org.githubLogin}>{org.name}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                You are not in any org with a swarm yet. The device picks your orgs up once you join one.
              </p>
            )}
            <div className="flex gap-2">
              <Button onClick={() => decide("approve")} disabled={acting !== null}>
                {acting === "approve" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Approve
              </Button>
              <Button variant="outline" onClick={() => decide("deny")} disabled={acting !== null}>
                {acting === "deny" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Deny
              </Button>
            </div>
          </div>
        ) : pairing.status === "approved" ? (
          <p className="text-sm">
            {pairing.decidedByYou
              ? `Approved. ${pairing.deviceName} finishes pairing on its own; you can close this page.`
              : "This pairing was approved from another account."}
          </p>
        ) : pairing.status === "consumed" ? (
          <p className="text-sm">
            {pairing.deviceName} is paired. Manage your devices in{" "}
            <Link href="/settings" className="underline">
              Settings
            </Link>
            .
          </p>
        ) : (
          <p className="text-sm">Denied. Nothing was connected.</p>
        )}
      </CardContent>
    </Card>
  );
}
