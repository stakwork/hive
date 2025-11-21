"use client";

import { useEffect, useState, useRef } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { WAKE_WORD } from "@/lib/constants/voice";
import { CallRecording, CallsResponse } from "@/types/calls";
import { CallsTable } from "@/components/calls/CallsTable";
import { ConnectRepository } from "@/components/ConnectRepository";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem } from "@/components/ui/pagination";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2, Phone, Mic, MicOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";

export default function CallsPage() {
  const { workspace, slug } = useWorkspace();
  const { toast } = useToast();
  const [calls, setCalls] = useState<CallRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const limit = 10;

  // Voice recording state
  const {
    isRecording,
    isSupported: isVoiceSupported,
    transcriptBuffer,
    currentTranscript,
    startRecording,
    stopRecording,
    getRecentTranscript,
  } = useVoiceRecorder();
  const [processingFeature, setProcessingFeature] = useState(false);
  const lastProcessedIndexRef = useRef(0);
  const lastProcessedTranscriptRef = useRef("");
  const hasDetectedFeatureRequestRef = useRef(false);
  const isProcessingDetectionRef = useRef(false);

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

  const handleToggleRecording = () => {
    if (isRecording) {
      stopRecording();
      lastProcessedIndexRef.current = 0;
      lastProcessedTranscriptRef.current = "";
      hasDetectedFeatureRequestRef.current = false;
      isProcessingDetectionRef.current = false;
    } else {
      startRecording();
    }
  };

  // Monitor transcript for wake word and feature requests
  useEffect(() => {
    if (!isRecording || !slug || processingFeature || hasDetectedFeatureRequestRef.current || isProcessingDetectionRef.current) return;

    // Set flag IMMEDIATELY before starting async work to block other effects
    isProcessingDetectionRef.current = true;

    const checkNewChunks = async () => {
      try {
        // Only check new chunks that haven't been processed
        const newChunks = transcriptBuffer.slice(lastProcessedIndexRef.current);

        // ALSO check current live transcript (text that hasn't been chunked yet)
        const textsToCheck: string[] = [];

        // Add new chunks
        newChunks.forEach(chunk => textsToCheck.push(chunk.text));

        // Add live transcript (may contain wake word before it's chunked)
        // Only if it's different from last processed transcript to avoid duplicates
        if (currentTranscript.trim() && currentTranscript !== lastProcessedTranscriptRef.current) {
          textsToCheck.push(currentTranscript);
        }

        if (textsToCheck.length === 0) return;

      // Process each text segment
      for (const text of textsToCheck) {
        // First check for wake word in frontend (avoid unnecessary API calls)
        if (!text.toLowerCase().includes(WAKE_WORD)) {
          continue;
        }

        console.log(`🎤 Wake word "${WAKE_WORD}" detected, checking if feature request...`);

        // Call API to detect if this is a feature request (requires AI/LLM)
        const detectionResponse = await fetch("/api/voice/detect-feature-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chunk: text,
            workspaceSlug: slug,
          }),
        });

        if (!detectionResponse.ok) {
          console.error("Failed to detect feature request");
          continue;
        }

        const detectionData = await detectionResponse.json();
        const isFeatureRequest = detectionData.isFeatureRequest;

        if (isFeatureRequest) {
          console.log("🎯 Feature request detected! Creating feature...");

          // Set flag immediately to prevent duplicate processing
          hasDetectedFeatureRequestRef.current = true;
          setProcessingFeature(true);

          try {
            // Get last hour of transcript from buffer (completed chunks)
            const bufferedTranscript = getRecentTranscript(20);

            // Also include current live transcript (may contain wake word before chunking)
            const fullTranscript = bufferedTranscript
              ? `${bufferedTranscript} ${currentTranscript}`
              : currentTranscript;

            if (!fullTranscript || fullTranscript.trim().length === 0) {
              throw new Error("No transcript available to create feature");
            }

            console.log("📝 Creating feature from transcript:", {
              bufferedLength: bufferedTranscript.length,
              currentLength: currentTranscript.length,
              totalLength: fullTranscript.length,
              preview: fullTranscript.substring(0, 100) + "...",
            });

            // Create feature in background
            const response = await fetch("/api/voice/create-feature", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                workspaceSlug: slug,
                transcript: fullTranscript,
              }),
            });

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              const errorMessage = errorData.error || `Failed to create feature (${response.status})`;
              throw new Error(errorMessage);
            }

            const data = await response.json();

            toast({
              title: "Feature created!",
              description: `"${data.title}" has been added to your workspace.`,
            });

            console.log("✅ Feature created:", data);
          } catch (error) {
            console.error("❌ Error creating feature:", error);
            toast({
              title: "Failed to create feature",
              description: error instanceof Error ? error.message : "Unknown error",
              variant: "destructive",
            });
            // Reset flag on error so user can retry
            hasDetectedFeatureRequestRef.current = false;
          } finally {
            setProcessingFeature(false);
          }

          // Stop checking after first feature request to avoid duplicates
          break;
        }
      }

        lastProcessedIndexRef.current = transcriptBuffer.length;
        lastProcessedTranscriptRef.current = currentTranscript;
      } finally {
        // Always reset processing flag, even if there was an error
        isProcessingDetectionRef.current = false;
      }
    };

    checkNewChunks();
  }, [transcriptBuffer, currentTranscript, isRecording, slug, processingFeature, getRecentTranscript, toast]);

  useEffect(() => {
    if (!slug || !workspace?.isCodeGraphSetup) {
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
  }, [slug, workspace?.isCodeGraphSetup, page]);

  if (!workspace?.isCodeGraphSetup) {
    return (
      <div className="space-y-6">
        <PageHeader title="Calls" />
        <ConnectRepository
          workspaceSlug={slug}
          title="Connect repository to view call recordings"
          description="Setup your development environment to access call recordings."
          buttonText="Connect Repository"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calls"
        actions={
          workspace?.isCodeGraphSetup ? (
            <div className="flex gap-2">
              {isVoiceSupported && (
                <Button
                  onClick={handleToggleRecording}
                  disabled={processingFeature}
                  variant={isRecording ? "destructive" : "default"}
                >
                  {processingFeature ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating Feature...
                    </>
                  ) : isRecording ? (
                    <>
                      <MicOff className="h-4 w-4 mr-2" />
                      Stop Recording
                    </>
                  ) : (
                    <>
                      <Mic className="h-4 w-4 mr-2" />
                      Record
                    </>
                  )}
                </Button>
              )}
              <Button onClick={handleStartCall} disabled={generatingLink}>
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

      {isRecording && (
        <Card className="border-red-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
              Recording in Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Say <strong>&quot;{WAKE_WORD}, make a feature from this&quot;</strong> to create a feature from the last
                hour of conversation.
              </p>
              {currentTranscript && (
                <div className="mt-3 p-3 bg-muted rounded-md">
                  <p className="text-sm font-mono">{currentTranscript}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
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
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
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
                        onClick={() => setPage(1)}
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
                          onClick={() => setPage((p) => p + 1)}
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
