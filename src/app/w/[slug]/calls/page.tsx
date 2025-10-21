"use client";

import { useEffect, useState, Suspense } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { CallRecording, CallsResponse } from "@/types/calls";
import { CallsTable } from "@/components/calls/CallsTable";
import { ConnectRepository } from "@/components/ConnectRepository";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "@/components/ui/pagination";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2, Phone } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSearchParams } from "next/navigation";

// Utility to detect Safari browser
function isSafari(): boolean {
  if (typeof window === 'undefined') return false;
  
  const userAgent = window.navigator.userAgent.toLowerCase();
  const isSafariBrowser = /^((?!chrome|android).)*safari/i.test(userAgent);
  
  return isSafariBrowser;
}

function CallsContent() {
  const { workspace, slug } = useWorkspace();
  const searchParams = useSearchParams();
  const [calls, setCalls] = useState<CallRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const limit = 10;

  const handleStartCall = async () => {
    if (!slug) return;

    setGeneratingLink(true);
    try {
      const response = await fetch(`/api/workspaces/${slug}/calls/generate-link`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate call link');
      }

      const data = await response.json();
      const callUrl = data.url;

      // On Safari, use the browser link directly (universal links)
      // On other browsers, use the deeplink scheme
      if (isSafari()) {
        window.open(callUrl, '_blank', 'noopener,noreferrer');
      } else {
        // Create deeplink URL: sphinx.chat://?action=call&link=<FULL_CALL_URL>
        const deeplinkUrl = `sphinx.chat://?action=call&link=${encodeURIComponent(callUrl)}`;
        window.location.href = deeplinkUrl;
      }
    } catch (err) {
      console.error('Error generating call link:', err);
      alert(err instanceof Error ? err.message : 'Failed to start call');
    } finally {
      setGeneratingLink(false);
    }
  };

  // Handle deeplink parameters
  useEffect(() => {
    const action = searchParams.get('action');
    const link = searchParams.get('link');

    // If this is a deeplink to start a call, trigger it automatically
    if (action === 'call' && link) {
      // Open the call link directly
      window.open(link, '_blank', 'noopener,noreferrer');
    }
  }, [searchParams]);

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
        const response = await fetch(
          `/api/workspaces/${slug}/calls?limit=${limit}&skip=${skip}`,
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch calls");
        }

        const data: CallsResponse = await response.json();
        setCalls(data.calls);
        setHasMore(data.hasMore);
      } catch (err) {
        console.error("Error fetching calls:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load call recordings",
        );
      } finally {
        setLoading(false);
      }
    };

    fetchCalls();
  }, [slug, workspace?.isCodeGraphSetup, page]);

  if (!workspace?.isCodeGraphSetup) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Calls"
          description="View your call recordings"
        />
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
        description="View your call recordings"
        actions={
          workspace?.isCodeGraphSetup ? (
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
          ) : null
        }
      />

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

export default function CallsPage() {
  return (
    <Suspense fallback={
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>
    }>
      <CallsContent />
    </Suspense>
  );
}
