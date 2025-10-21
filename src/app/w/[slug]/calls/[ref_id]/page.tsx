"use client";

import { GraphComponent } from "@/components/knowledge-graph";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/hooks/useWorkspace";
import { CallRecording } from "@/types/calls";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function CallPage() {
  const params = useParams();
  const router = useRouter();
  const { slug } = useWorkspace();
  const ref_id = params.ref_id as string;

  const [call, setCall] = useState<CallRecording | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleBackClick = () => {
    router.push(`/w/${slug}/calls`);
  };

  useEffect(() => {
    if (!slug || !ref_id) {
      setLoading(false);
      return;
    }

    const fetchCall = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/workspaces/${slug}/calls?limit=1000`,
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch call");
        }

        const data = await response.json();
        const foundCall = data.calls.find((c: CallRecording) => c.ref_id === ref_id);

        if (!foundCall) {
          throw new Error("Call not found");
        }

        setCall(foundCall);
      } catch (err) {
        console.error("Error fetching call:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load call recording",
        );
      } finally {
        setLoading(false);
      }
    };

    fetchCall();
  }, [slug, ref_id]);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={handleBackClick}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <span className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading...
          </span>
        </div>

        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2 mt-2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !call) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={handleBackClick}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold text-red-600">Error</h2>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{error || "Call not found"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with back button */}
      <Button variant="ghost" size="sm" onClick={handleBackClick} className="self-start">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back
      </Button>

      {/* Call Details Card */}
      <Card>
        <CardHeader>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">{call.episode_title}</h1>
            <p className="text-sm text-muted-foreground">
              Added {formatDate(call.date_added_to_graph)}
            </p>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {call.description ? (
            <div>
              <h2 className="text-lg font-semibold mb-4">Description</h2>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <MarkdownRenderer>{call.description}</MarkdownRenderer>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No description available for this call recording.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Episode Knowledge Graph */}
      <Card>
        <CardContent className="pt-6">
          <GraphComponent endpoint={`/graph/subgraph?include_properties=true&start_node=${call.ref_id}&depth=1&min_depth=0&limit=100&sort_by=date_added_to_graph&order_by=desc`} />
        </CardContent>
      </Card>
    </div>
  );
}
