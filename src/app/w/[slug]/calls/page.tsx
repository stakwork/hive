"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useVoiceStore } from "@/stores/useVoiceStore";
import { CallRecording, CallsResponse } from "@/types/calls";
import { CallsTable } from "@/components/calls/CallsTable";
import { VoiceMessagesDrawer } from "@/components/voice/VoiceMessagesDrawer";
import { PoolLaunchBanner } from "@/components/pool-launch-banner";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem } from "@/components/ui/pagination";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2, Phone, Mic, MicOff, MessageSquare, Unplug } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

export default function CallsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { workspace, slug } = useWorkspace();
  const [calls, setCalls] = useState<CallRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(() => parseInt(searchParams?.get("page") ?? "1", 10) || 1);
  const [hasMore, setHasMore] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const limit = 10;

  // Voice agent state (LiveKit)
  const isConnected = useVoiceStore((s) => s.isConnected);
  const isConnecting = useVoiceStore((s) => s.isConnecting);
  const isMicEnabled = useVoiceStore((s) => s.isMicEnabled);
  const voiceError = useVoiceStore((s) => s.error);
  const messages = useVoiceStore((s) => s.messages);
  const connect = useVoiceStore((s) => s.connect);
  const disconnect = useVoiceStore((s) => s.disconnect);
  const toggleMic = useVoiceStore((s) => s.toggleMic);
  const clearError = useVoiceStore((s) => s.clearError);

  // Show toast on voice connection errors
  useEffect(() => {
    if (voiceError) {
      toast.error("Voice connection failed", { description: voiceError });
      clearError();
    }
  }, [voiceError, clearError]);

  const handleConnectVoice = () => {
    if (!slug) return;
    if (isConnected) {
      disconnect();
    } else {
      connect(slug);
    }
  };

  const handleStartCall = async () => {
    if (!slug) return;

    setGeneratingLink(true);
    try {
      const response = await fetch(`/api/workspaces/${slug}/calls/generate-link`, {
        method: "POST",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate call link");
      }

      const data = await response.json();
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("Error generating call link:", err);
      alert(err instanceof Error ? err.message : "Failed to start call");
    } finally {
      setGeneratingLink(false);
    }
  };

  // Navigate to a specific page and update URL
  const goToPage = useCallback((n: number) => {
    setPage(n);
    const params = new URLSearchParams(searchParams?.toString() || "");
    if (n <= 1) {
      params.delete("page");
    } else {
      params.set("page", n.toString());
    }
    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!slug || workspace?.poolState !== "COMPLETE") {
      setLoading(false);
      return;
    }

    const fetchCalls = async () => {
      setLoading(true);
      setError(null);

      try {
        const skip = (page - 1) * limit;
        const response = await fetch(`/api/workspaces/${slug}/calls?limit=${limit}&skip=${skip}`);

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch calls");
        }

        const data: CallsResponse = await response.json();
        setCalls(data.calls);
        setHasMore(data.hasMore);
      } catch (err) {
        console.error("Error fetching calls:", err);
        setError(err instanceof Error ? err.message : "Failed to load call recordings");
      } finally {
        setLoading(false);
      }
    };

    fetchCalls();
  }, [slug, workspace?.poolState, page]);

  if (workspace?.poolState !== "COMPLETE") {
    return (
      <div className="space-y-6">
        <PageHeader title="Calls" />
        <PoolLaunchBanner
          title="Complete Pool Setup to View Call Recordings"
          description="Launch your development pods to access call recordings and transcripts."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calls"
        actions={
          workspace?.poolState === "COMPLETE" ? (
            <div className="flex gap-2">
              <Button
                onClick={handleConnectVoice}
                disabled={isConnecting}
                variant={isConnected ? "destructive" : "default"}
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : isConnected ? (
                  <>
                    <Unplug className="h-4 w-4 mr-2" />
                    Disconnect
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4 mr-2" />
                    Connect Voice
                  </>
                )}
              </Button>
              {isConnected && (
                <>
                  <Button onClick={() => toggleMic()} variant="outline" size="icon">
                    {isMicEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                  </Button>
                  <Button
                    onClick={() => setDrawerOpen(true)}
                    variant="outline"
                    size="icon"
                    className="relative"
                  >
                    <MessageSquare className="h-4 w-4" />
                    {messages.length > 0 && (
                      <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-[10px] font-medium text-primary-foreground flex items-center justify-center">
                        {messages.length}
                      </span>
                    )}
                  </Button>
                </>
              )}
              <Button onClick={handleStartCall} disabled={generatingLink} data-testid="start-call-button">
                {generatingLink ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Phone className="h-4 w-4 mr-2" />
                    Start Call
                  </>
                )}
              </Button>
            </div>
          ) : null
        }
      />

      <VoiceMessagesDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />

      <Card data-testid="call-recordings-card">
        <CardHeader>
          <CardTitle>Call Recordings</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && (
            <div className="rounded-md border">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Date Added</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-5 w-full max-w-xs" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-32" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {error && !loading && (
            <div className="text-center py-12">
              <p className="text-red-600 mb-2">Error loading calls</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          )}

          {!loading && !error && <CallsTable calls={calls} workspaceSlug={slug} />}

          {!loading && !error && calls.length > 0 && (
            <div className="mt-6">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <Button
                      variant="ghost"
                      size="default"
                      onClick={() => goToPage(Math.max(1, page - 1))}
                      disabled={page === 1}
                      className="gap-1 pl-2.5"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span>Previous</span>
                    </Button>
                  </PaginationItem>

                  {page > 1 && (
                    <PaginationItem>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => goToPage(1)}
                        className={buttonVariants({ variant: "ghost", size: "icon" })}
                      >
                        1
                      </Button>
                    </PaginationItem>
                  )}

                  {page > 2 && (
                    <PaginationItem>
                      <PaginationEllipsis />
                    </PaginationItem>
                  )}

                  <PaginationItem>
                    <Button
                      variant="outline"
                      size="icon"
                      className={buttonVariants({ variant: "outline", size: "icon" })}
                      disabled
                    >
                      {page}
                    </Button>
                  </PaginationItem>

                  {hasMore && (
                    <>
                      <PaginationItem>
                        <PaginationEllipsis />
                      </PaginationItem>
                      <PaginationItem>
                        <Button
                          variant="ghost"
                          size="default"
                          onClick={() => goToPage(page + 1)}
                          className="gap-1 pr-2.5"
                        >
                          <span>Next</span>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </PaginationItem>
                    </>
                  )}
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
