import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Clock, Sparkles } from 'lucide-react'

export interface TranscriptSegment {
  id: string
  speaker?: string
  text: string
  startTime: number
  endTime: number
  confidence?: number
}

// Utility to highlight "hive" keyword in transcript text
function highlightKeyword(text: string): React.ReactNode {
  const keywordPattern = /\bhive\b/gi;
  const parts = text.split(keywordPattern);
  const matches = text.match(keywordPattern) || [];
  
  return parts.map((part, index) => (
    <React.Fragment key={index}>
      {part}
      {matches[index] && (
        <span className="text-emerald-600 font-semibold bg-emerald-50 px-1 rounded">
          {matches[index]}
        </span>
      )}
    </React.Fragment>
  ));
}

interface TranscriptPanelProps {
  segments: TranscriptSegment[]
  currentTime: number
  onSegmentClick?: (startTime: number) => void
  loading?: boolean
  processingFeature?: boolean
}

export const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
  segments,
  currentTime,
  onSegmentClick,
  loading = false,
  processingFeature = false
}) => {
  // Find the current active segment
  const currentSegment = segments.find(segment =>
    currentTime >= segment.startTime && currentTime <= segment.endTime
  )

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const getTimestamp = (startTime: number, endTime: number) => {
    return `${formatTime(startTime)} - ${formatTime(endTime)}`
  }

  if (loading) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-sm">Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-4 bg-muted rounded animate-pulse w-16" />
                <div className="h-3 bg-muted rounded animate-pulse w-full" />
                <div className="h-3 bg-muted rounded animate-pulse w-3/4" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (segments.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-sm">Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">
            <p className="mb-2">No transcript available</p>
            <p className="text-xs">Transcript may still be processing or unavailable for this recording.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex-none">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Current Transcript
          <Badge variant="secondary" className="text-xs">
            {formatTime(currentTime)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 p-0 min-h-0">
        <ScrollArea className="h-full">
          <div className="p-4">
            {currentSegment ? (
              <div className="space-y-4">
                {/* Timestamp and Speaker */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-mono">
                    {getTimestamp(currentSegment.startTime, currentSegment.endTime)}
                  </span>
                  {currentSegment.speaker && (
                    <Badge variant="outline" className="text-xs">
                      {currentSegment.speaker}
                    </Badge>
                  )}
                  {currentSegment.confidence && (
                    <span className="text-xs text-muted-foreground">
                      {Math.round(currentSegment.confidence * 100)}%
                    </span>
                  )}
                </div>

                {/* Current Transcript Text */}
                <div
                  className="p-4 rounded-lg bg-primary/10 border-primary/20 border cursor-pointer transition-all duration-200 hover:bg-primary/15"
                  onClick={() => onSegmentClick?.(currentSegment.startTime)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSegmentClick?.(currentSegment.startTime);
                    }
                  }}
                >
                  <p className="text-sm leading-relaxed text-foreground font-medium">
                    {highlightKeyword(currentSegment.text)}
                  </p>
                  
                  {processingFeature && (
                    <div className="mt-3 flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs animate-pulse">
                        <Sparkles className="h-3 w-3 mr-1" />
                        Creating feature...
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                <p className="mb-2">No transcript for current time</p>
                <p className="text-xs">
                  {segments.length > 0
                    ? "Transcript segments available - seek to a different time to view"
                    : "No transcript segments available"
                  }
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

