"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { MAX_CAPTCHA_SITES, normalizeSite } from "@/lib/captcha";

/** The sites a job may ask for a captcha on: read by every member, edited by admins. */
export function CaptchaSitesSettings() {
  const { slug } = useWorkspace();
  const { canAdmin } = useWorkspaceAccess();
  const [sites, setSites] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const url = `/api/workspaces/${slug}/settings/captcha-sites`;

  useEffect(() => {
    if (!slug) return;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((out) => setSites(Array.isArray(out?.data?.captchaAllowedSites) ? out.data.captchaAllowedSites : []))
      .catch(() => {});
  }, [slug, url]);

  const save = useCallback(
    async (next: string[]) => {
      setSaving(true);
      try {
        const res = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ captchaAllowedSites: next }) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
        setSites(out.data.captchaAllowedSites);
        return true;
      } catch (err) {
        toast.error("Error", { description: err instanceof Error ? err.message : "Could not save" });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [url],
  );

  const add = async () => {
    const site = normalizeSite(draft);
    if (!site) return toast.error("Error", { description: "Enter a hostname, like example.com" });
    if (sites.includes(site)) return setDraft("");
    if (sites.length >= MAX_CAPTCHA_SITES) return toast.error("Error", { description: `At most ${MAX_CAPTCHA_SITES} sites` });
    if (await save([...sites, site])) setDraft("");
  };

  return (
    <Card data-testid="captcha-sites">
      <CardHeader>
        <CardTitle>Captcha sites</CardTitle>
        <CardDescription>Sites where a job may ask a person to solve a captcha. Subdomains are included.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sites.length === 0 && <p className="text-sm text-muted-foreground">No sites allowed.</p>}
        <ul className="space-y-1">
          {sites.map((site) => (
            <li key={site} className="flex items-center justify-between rounded border px-2 py-1 text-sm">
              <span className="font-mono">{site}</span>
              {canAdmin && (
                <button type="button" aria-label={`Remove ${site}`} disabled={saving} onClick={() => save(sites.filter((s) => s !== site))}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {canAdmin && (
          <div className="flex gap-2">
            <Input
              value={draft}
              placeholder="example.com"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
            <Button type="button" disabled={saving || !draft.trim()} onClick={add}>
              Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
