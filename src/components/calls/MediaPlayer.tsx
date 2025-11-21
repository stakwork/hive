import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Maximize, Minimize, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

interface MediaPlayerProps {
  src?: string;
  title: string;
  imageUrl?: string;
  onTimeUpdate?: (currentTime: number) => void;
  seekToTime?: number;
  className?: string;
  showExpandButton?: boolean;
}

const isVideoFile = (url: string) => /\.(mp4|webm|mov|mkv|avi)(\?.*)?$/i.test(url);

export const MediaPlayer: React.FC<MediaPlayerProps> = ({
  src,
  title,
  imageUrl,
  onTimeUpdate,
  seekToTime,
  className,
  showExpandButton = true,
}) => {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const isVideo = src ? isVideoFile(src) : false;

  // Handle external seek requests
  useEffect(() => {
    if (seekToTime !== undefined && mediaRef.current) {
      mediaRef.current.currentTime = seekToTime;
    }
  }, [seekToTime]);

  const handlePlayPause = useCallback(() => {
    if (!mediaRef.current || !src) return;

    if (isPlaying) {
      mediaRef.current.pause();
    } else {
      mediaRef.current.play();
    }
  }, [isPlaying, src]);

  const handleTimeUpdate = useCallback(() => {
    if (!mediaRef.current) return;

    const current = mediaRef.current.currentTime;
    setCurrentTime(current);
    onTimeUpdate?.(current);
  }, [onTimeUpdate]);

  const handleLoadedMetadata = useCallback(() => {
    if (!mediaRef.current) return;
    setDuration(mediaRef.current.duration);
    setIsReady(true);
  }, []);

  const handleSeek = useCallback((value: number[]) => {
    if (!mediaRef.current) return;
    const time = value[0];
    mediaRef.current.currentTime = time;
    setCurrentTime(time);
  }, []);

  const handleVolumeChange = useCallback((value: number[]) => {
    if (!mediaRef.current) return;
    const vol = value[0];
    mediaRef.current.volume = vol;
    setVolume(vol);
    setIsMuted(vol === 0);
  }, []);

  const toggleMute = useCallback(() => {
    if (!mediaRef.current) return;

    if (isMuted) {
      mediaRef.current.volume = volume;
      setIsMuted(false);
    } else {
      mediaRef.current.volume = 0;
      setIsMuted(true);
    }
  }, [isMuted, volume]);

  const skip = useCallback(
    (seconds: number) => {
      if (!mediaRef.current) return;
      mediaRef.current.currentTime = Math.max(0, Math.min(duration, currentTime + seconds));
    },
    [currentTime, duration],
  );

  const toggleFullScreen = useCallback(() => {
    setIsFullScreen(!isFullScreen);
  }, [isFullScreen]);

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleError = useCallback(() => {
    setHasError(true);
    setIsBuffering(false);
  }, []);

  const handleWaiting = useCallback(() => {
    setIsBuffering(true);
  }, []);

  const handleCanPlay = useCallback(() => {
    setIsBuffering(false);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target !== document.body) return;

      switch (event.code) {
        case "Space":
          event.preventDefault();
          handlePlayPause();
          break;
        case "ArrowLeft":
          event.preventDefault();
          skip(-10);
          break;
        case "ArrowRight":
          event.preventDefault();
          skip(10);
          break;
        case "KeyM":
          event.preventDefault();
          toggleMute();
          break;
        case "KeyF":
          if (isVideo) {
            event.preventDefault();
            toggleFullScreen();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlePlayPause, skip, toggleMute, toggleFullScreen, isVideo]);

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";

    const hours = Math.floor(time / 3600);
    const minutes = Math.floor((time % 3600) / 60);
    const seconds = Math.floor(time % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  if (!src) {
    return (
      <Card className={className}>
        <CardContent className="p-4">
          <div className="text-center text-muted-foreground">
            {imageUrl && (
              <div className="mb-4 flex justify-center">
                <Avatar className="h-24 w-24">
                  <AvatarImage src={imageUrl} alt={title} className="object-cover" />
                  <AvatarFallback>{title.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
              </div>
            )}
            <p className="mb-2">No media available</p>
            <p className="text-sm">{title}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const mediaProps = {
    ref: mediaRef as any,
    src,
    onTimeUpdate: handleTimeUpdate,
    onLoadedMetadata: handleLoadedMetadata,
    onPlay: handlePlay,
    onPause: handlePause,
    onEnded: handleEnded,
    onError: handleError,
    onWaiting: handleWaiting,
    onCanPlay: handleCanPlay,
    controls: false,
    preload: "metadata" as const,
  };

  return (
    <Card className={`${className} ${isFullScreen ? "fixed inset-0 z-50 rounded-none" : ""}`}>
      <CardContent className={`${isFullScreen ? "h-full flex flex-col" : "p-4"}`}>
        {/* Media Container */}
        <div
          className={`relative ${isFullScreen ? "flex-1 flex items-center justify-center bg-black" : "mb-4"} ${isVideo ? "bg-black rounded" : ""}`}
        >
          {/* Cover Image for Audio */}
          {!isVideo && imageUrl && (
            <div className="absolute inset-0 flex items-center justify-center z-0">
              <Avatar className="h-32 w-32 opacity-20">
                <AvatarImage src={imageUrl} alt={title} className="object-cover" />
                <AvatarFallback>{title.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            </div>
          )}

          {/* Media Element */}
          {isVideo ? (
            <video
              {...mediaProps}
              className={`w-full ${isFullScreen ? "h-full object-contain" : "aspect-video"}`}
              poster={imageUrl}
            />
          ) : (
            <audio {...mediaProps} className="w-full" />
          )}

          {/* Fullscreen Toggle for Video */}
          {isVideo && showExpandButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleFullScreen}
              className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white"
            >
              {isFullScreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </Button>
          )}

          {/* Loading/Error Overlay */}
          {isBuffering && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            </div>
          )}

          {hasError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
              <p>Error loading media</p>
            </div>
          )}
        </div>

        {/* Controls Container */}
        <div className={isFullScreen ? "p-4 bg-black/80 text-white" : ""}>
          {/* Title */}
          <div className="mb-4">
            <h3 className="font-medium text-sm line-clamp-1">{title}</h3>
            {isFullScreen && (
              <div className="text-xs text-muted-foreground mt-1">
                Use space to play/pause, ← → to skip, M to mute, F for fullscreen
              </div>
            )}
          </div>

          {/* Progress Bar */}
          <div className="mb-4">
            <Slider
              value={[currentTime]}
              max={duration || 100}
              step={0.1}
              onValueChange={handleSeek}
              className="mb-2"
              disabled={!isReady}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => skip(-10)} disabled={!isReady}>
                <SkipBack className="h-4 w-4" />
              </Button>

              <Button variant="ghost" size="sm" onClick={handlePlayPause} disabled={!isReady}>
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>

              <Button variant="ghost" size="sm" onClick={() => skip(10)} disabled={!isReady}>
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>

            {/* Volume Control */}
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={toggleMute} disabled={!isReady}>
                {isMuted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              <div className="w-16">
                <Slider
                  value={[isMuted ? 0 : volume]}
                  max={1}
                  step={0.1}
                  onValueChange={handleVolumeChange}
                  disabled={!isReady}
                />
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
