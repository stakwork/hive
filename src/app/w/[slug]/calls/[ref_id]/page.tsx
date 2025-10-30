"use client";

import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { MediaPlayer } from "@/components/calls/MediaPlayer";
import { SynchronizedGraphComponent } from "@/components/calls/SynchronizedGraphComponent";
import { TranscriptPanel, TranscriptSegment } from "@/components/calls/TranscriptPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/hooks/useWorkspace";
import { CallRecording } from "@/types/calls";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const nodeTypes = ['-Clip', '-Episode']
const nodeTypeParam = JSON.stringify(nodeTypes)

export default function CallPage() {
  const params = useParams();
  const router = useRouter();
  const { slug, id: workspaceId } = useWorkspace();
  const ref_id = params.ref_id as string;

  const [call, setCall] = useState<CallRecording | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [seekToTime, setSeekToTime] = useState<number | undefined>(undefined);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [presignedUrl, setPresignedUrl] = useState<string | null>(null);

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

  const generatePresignedUrl = async (s3Key: string): Promise<string | null> => {
    try {
      const response = await fetch('/api/calls/presigned-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ s3Key }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate presigned URL');
      }

      const { presignedUrl } = await response.json();
      return presignedUrl;
    } catch (error) {
      console.error('Error generating presigned URL:', error);
      return null;
    }
  };

  const isS3Key = (url: string): boolean => {
    // Check if the URL looks like an S3 key (has .mp4 extension and doesn't start with http)
    // S3 keys from your example: "2025-10-30T09%3A41%3A13.520Z-sphinx.call.-swarm38.sphinx.chat-.783510069.78522.mp4"
    return url.includes('.mp4') && !url.startsWith('http') && !url.startsWith('blob:');
  };


  useEffect(() => {
    if (!workspaceId || !ref_id) {
      setLoading(false);
      return;
    }

    const fetchCallData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Fetch the subgraph data for this specific call
        const response = await fetch(
          `/api/swarm/jarvis/nodes?id=${workspaceId}&endpoint=${encodeURIComponent(`/graph/subgraph?start_node=${ref_id}&node_type=["Episode","Clip","Video"]&depth=2&include_properties=true`)}`
        );

        if (!response.ok) {
          throw new Error("Failed to fetch call data");
        }

        const data = await response.json();

        if (!data.success || !data.data?.nodes) {
          throw new Error("Invalid response data");
        }

        // Find the main call node
        const callNode = data.data.nodes.find((node: any) =>
          (node.node_type === "Episode" || node.node_type === "Clip") && node.ref_id === ref_id
        );

        if (!callNode) {
          throw new Error("Call not found");
        }

        // Extract call data
        const callData: CallRecording = {
          ref_id: callNode.ref_id,
          episode_title: callNode.properties?.episode_title || "Untitled Call",
          date_added_to_graph: callNode.date_added_to_graph || 0,
          description: callNode.properties?.description,
          source_link: callNode.properties?.source_link,
          media_url: callNode.properties?.media_url,
          image_url: callNode.properties?.image_url,
        };

        setCall(callData);

        // Generate presigned URL if source_link is an S3 key
        if (callData.source_link && isS3Key(callData.source_link)) {
          const url = await generatePresignedUrl(callData.source_link);
          setPresignedUrl(url);
        }

        // Extract transcript from video nodes
        const videoNodes = data.data.nodes.filter((node: any) =>
          node.node_type === "Video" && node.properties?.text && node.properties?.timestamp
        );

        const transcriptSegments = videoNodes.map((node: any) => {
          const timestampStr = node.properties.timestamp || "0-0";
          const [startStr, endStr] = timestampStr.split('-');
          const startTime = Number.parseInt(startStr) / 1000;
          const endTime = Number.parseInt(endStr) / 1000;

          return {
            id: node.ref_id,
            text: node.properties.text || "",
            startTime: Number.isNaN(startTime) ? 0 : startTime,
            endTime: Number.isNaN(endTime) ? startTime + 10 : endTime,
          };
        }).sort((a: any, b: any) => a.startTime - b.startTime);

        setTranscript(transcriptSegments);

      } catch (err) {
        console.error("Error fetching call data:", err);
        setError(err instanceof Error ? err.message : "Failed to load call data");
      } finally {
        setLoading(false);
      }
    };

    fetchCallData();
  }, [workspaceId, ref_id]);

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
                src={presignedUrl || call.source_link || call.media_url}
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
