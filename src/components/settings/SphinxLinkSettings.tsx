"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Zap, Unlink, Save } from "lucide-react";
import { SphinxLinkModal } from "@/components/SphinxLinkModal";
import { toast } from "sonner";

export function SphinxLinkSettings() {
  const { data: session, update } = useSession();
  const [showModal, setShowModal] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [sphinxAlias, setSphinxAlias] = useState(session?.user?.sphinxAlias || "");
  const [isSaving, setIsSaving] = useState(false);
  
  const isLinked = !!session?.user?.lightningPubkey;
  
  const handleUnlink = async () => {
    setIsUnlinking(true);
    try {
      const res = await fetch("/api/auth/sphinx/unlink", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to unlink");
      await update(); // Refresh session
      toast.success("Sphinx account unlinked");
    } catch (_error) {
      toast.error("Failed to unlink Sphinx account");
    } finally {
      setIsUnlinking(false);
    }
  };
  
  const handleSaveAlias = async () => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sphinxAlias: sphinxAlias.trim() || null }),
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to save");
      }
      
      await update(); // Refresh session
      toast.success("Sphinx alias saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save alias");
    } finally {
      setIsSaving(false);
    }
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5" />
          Sphinx Account
        </CardTitle>
        <CardDescription>
          Link your Sphinx app to perform GitHub actions from mobile
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLinked ? (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Linked</Badge>
                <span className="text-sm text-muted-foreground">
                  ...{session.user.lightningPubkey?.slice(-8)}
                </span>
              </div>
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleUnlink}
                disabled={isUnlinking}
              >
                <Unlink className="h-4 w-4 mr-2" />
                Unlink
              </Button>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="sphinx-alias">Tribe alias</Label>
              <div className="flex gap-2">
                <Input
                  id="sphinx-alias"
                  placeholder="Your Sphinx tribe username"
                  value={sphinxAlias}
                  onChange={(e) => setSphinxAlias(e.target.value)}
                  maxLength={50}
                />
                <Button 
                  size="sm"
                  onClick={handleSaveAlias}
                  disabled={isSaving}
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>
              </div>
              {session?.user?.sphinxAlias && (
                <p className="text-xs text-muted-foreground">
                  Current alias: @{session.user.sphinxAlias}
                </p>
              )}
            </div>
          </>
        ) : (
          <Button onClick={() => setShowModal(true)}>
            <Zap className="h-4 w-4 mr-2" />
            Link Sphinx App
          </Button>
        )}
      </CardContent>
      
      <SphinxLinkModal open={showModal} onOpenChange={setShowModal} />
    </Card>
  );
}
