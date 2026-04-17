"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Download, Eye, EyeOff, Loader2, Plus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CreateSwarmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

interface SwarmCredentials {
  swarm_id: string;
  address: string;
  ec2_id: string;
  x_api_key: string;
  password: string;
}

function generatePassword(): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const nums = "0123456789";
  const special = "!@#%^*()_+-=[]{}:,.";
  const all = upper + lower + nums + special;
  const arr = new Uint8Array(20);
  crypto.getRandomValues(arr);
  let pwd = upper[arr[0] % upper.length] + lower[arr[1] % lower.length] +
    nums[arr[2] % nums.length] + special[arr[3] % special.length];
  for (let i = 4; i < 20; i++) pwd += all[arr[i] % all.length];
  return pwd.split("").sort(() => Math.random() - 0.5).join("");
}

export default function CreateSwarmDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateSwarmDialogProps) {
  const [autoGenerate, setAutoGenerate] = useState(true);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [credentials, setCredentials] = useState<SwarmCredentials | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const refreshPassword = useCallback(() => {
    setPassword(generatePassword());
  }, []);

  // Generate a password on mount and when auto-generate is toggled on
  useEffect(() => {
    if (autoGenerate) refreshPassword();
  }, [autoGenerate, refreshPassword]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setAutoGenerate(true);
      setShowPassword(false);
      setSubmitting(false);
      setCredentials(null);
      setDownloaded(false);
      setConfirmed(false);
      refreshPassword();
    }
  }, [open, refreshPassword]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const body: Record<string, string> = { password };

      const res = await fetch("/api/admin/swarms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.error ?? data.message ?? "Failed to create swarm");
        return;
      }

      setCredentials({
        swarm_id: data.data.swarm_id,
        address: data.data.address,
        ec2_id: data.data.ec2_id,
        x_api_key: data.data.x_api_key,
        password: data.password,
      });
    } catch {
      toast.error("Failed to create swarm");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownload = () => {
    if (!credentials) return;
    const { swarm_id, address, ec2_id, x_api_key, password: pwd } = credentials;
    const csv =
      "swarm_id,address,ec2_id,x_api_key,password\n" +
      `${swarm_id},${address},${ec2_id},${x_api_key},${pwd}`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `swarm-${swarm_id}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  };

  const handleClose = () => {
    onOpenChange(false);
    if (credentials) onCreated();
  };

  const canClose = downloaded || confirmed;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && credentials && !canClose) return; onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Swarm</DialogTitle>
          <DialogDescription>
            Provision a new swarm EC2 instance.
          </DialogDescription>
        </DialogHeader>

        {!credentials ? (
          /* ── Form State ── */
          <div className="space-y-5">
            {/* Password */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="auto-generate"
                  checked={autoGenerate}
                  onCheckedChange={(checked) => setAutoGenerate(!!checked)}
                />
                <Label htmlFor="auto-generate" className="cursor-pointer">
                  Auto-generate password
                </Label>
              </div>

              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => !autoGenerate && setPassword(e.target.value)}
                  readOnly={autoGenerate}
                  placeholder={autoGenerate ? "" : "Enter password"}
                  className="pr-10 font-mono text-sm"
                  data-testid="password-input"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={submitting || !password}
              data-testid="create-swarm-submit"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create Swarm"
              )}
            </Button>
          </div>
        ) : (
          /* ── Results State ── */
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Save this information now — it will not be shown again after you leave this page.
              </AlertDescription>
            </Alert>

            <div className="space-y-2 rounded-md border p-3">
              {(
                [
                  ["Swarm ID", credentials.swarm_id],
                  ["Address", credentials.address],
                  ["EC2 ID", credentials.ec2_id],
                  ["API Key", credentials.x_api_key],
                  ["Password", credentials.password],
                ] as [string, string][]
              ).map(([label, value]) => (
                <div key={label} className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-mono text-sm break-all">{value}</p>
                </div>
              ))}
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={handleDownload}
              data-testid="download-credentials"
            >
              <Download className="mr-2 h-4 w-4" />
              Download Credentials
            </Button>

            <div className="flex items-center gap-2">
              <Checkbox
                id="saved-confirm"
                checked={confirmed}
                onCheckedChange={(c) => setConfirmed(!!c)}
                data-testid="saved-confirm"
              />
              <Label htmlFor="saved-confirm" className="cursor-pointer text-sm">
                I&apos;ve saved this information
              </Label>
            </div>

            <Button
              className="w-full"
              onClick={handleClose}
              disabled={!canClose}
              data-testid="close-button"
            >
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
