"use client";

import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { MediaPlayer } from "@/components/calls/MediaPlayer";
import { SynchronizedGraphComponent } from "@/components/calls/SynchronizedGraphComponent";
import { TranscriptPanel } from "@/components/calls/TranscriptPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useDataStore } from "@/stores/useDataStore";
import { CallRecording } from "@/types/calls";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const nodeTypes = ['-Clip', '-Episode']
const nodeTypeParam = JSON.stringify(nodeTypes)

export default function CallPage() {
  const params = useParams();
  const router = useRouter();
  const { slug } = useWorkspace();
  const ref_id = params.ref_id as string;

  const [call, setCall] = useState<CallRecording | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [seekToTime, setSeekToTime] = useState<number | undefined>(undefined);

  const nodesNormalized = useDataStore((s) => s.nodesNormalized);

  // Extract transcript from Video nodes in the store
  const transcript = useMemo(() => {
    const videoNodes = Array.from(nodesNormalized.values())
      .filter(node => node.node_type === "Video" && node.properties?.text && node.properties?.timestamp);

    return videoNodes.map(node => {
      const timestampStr = node?.properties?.timestamp || "0-0";
      const [startStr, endStr] = timestampStr.split('-');
      const startTime = parseInt(startStr) / 1000; // Convert from milliseconds to seconds
      const endTime = parseInt(endStr) / 1000; // Convert from milliseconds to seconds

      return {
        id: node.ref_id,
        text: node?.properties?.text || "",
        startTime: isNaN(startTime) ? 0 : startTime,
        endTime: isNaN(endTime) ? startTime + 10 : endTime, // Default to 10 seconds if endTime is invalid
      };
    }).sort((a, b) => a.startTime - b.startTime); // Sort by start time
  }, [nodesNormalized]);

  const handleBackClick = () => {
    router.push(`/w/${slug}/calls`);
  };

  const handleTimeUpdate = (time: number) => {
    setCurrentTime(time);
  };

  const handleTranscriptSegmentClick = (startTime: number) => {
    setSeekToTime(startTime);
    // Clear the seek request after a short delay
    setTimeout(() => setSeekToTime(undefined), 100);
  };

  const handleTimeMarkerClick = (time: number) => {
    setSeekToTime(time);
    // Clear the seek request after a short delay
    setTimeout(() => setSeekToTime(undefined), 100);
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

  console.log(transcript, "transcript")

  return (
    <div className="min-h-screen">
      {/* Main viewport content - slightly less than screen height */}
      <div className="h-[calc(100vh-6rem)] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-none p-4 border-b bg-background">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={handleBackClick}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Calls
            </Button>
            <div className="text-right">
              <h1 className="text-lg font-semibold">{call.episode_title}</h1>
              <p className="text-sm text-muted-foreground">
                Added {formatDate(call.date_added_to_graph)}
              </p>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Sidebar - Player and Transcript */}
          <div className="w-80 border-r flex flex-col min-h-0">
            {/* Media Player */}
            <div className="flex-none p-4">
              <MediaPlayer
                src={call.source_link || call.media_url}
                title={call.episode_title}
                imageUrl={call.image_url}
                onTimeUpdate={handleTimeUpdate}
                seekToTime={seekToTime}
              />
            </div>

            {/* Transcript Panel */}
            <div className="flex-1 min-h-0">
              <div className="h-full px-4 pb-4">
                <TranscriptPanel
                  segments={transcript}
                  currentTime={currentTime}
                  onSegmentClick={handleTranscriptSegmentClick}
                  loading={false}
                />
              </div>
            </div>
          </div>

          {/* Right Side - Synchronized Knowledge Graph */}
          <div className="flex-1 p-4 min-h-0 overflow-hidden">
            <div className="h-full">
              <SynchronizedGraphComponent
                endpoint={`/graph/subgraph?node_type=${encodeURIComponent(nodeTypeParam)}&include_properties=true&start_node=${call.ref_id}&depth=2&min_depth=0&limit=100&sort_by=date_added_to_graph&order_by=desc`}
                height="h-full"
                width="w-full"
                currentTime={currentTime}
                onTimeMarkerClick={handleTimeMarkerClick}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Description section - below the fold, accessible by scrolling */}
      {call.description && (
        <div className="p-6 border-t bg-background">
          <h3 className="text-lg font-medium mb-3">Description</h3>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <MarkdownRenderer>{call.description}</MarkdownRenderer>
          </div>
        </div>
      )}
    </div>
  );
}
