import React, { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent } from "@/components/ui/card";
import { Play, Pause, Volume2, VolumeX, SkipBack, SkipForward } from "lucide-react";

interface AudioPlayerProps {
  src?: string;
  title: string;
  onTimeUpdate?: (currentTime: number) => void;
  seekToTime?: number;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, title, onTimeUpdate, seekToTime }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  // Handle external seek requests
  useEffect(() => {
    if (seekToTime !== undefined && audioRef.current) {
      audioRef.current.currentTime = seekToTime;
    }
  }, [seekToTime]);

  const handlePlayPause = () => {
    if (!audioRef.current || !src) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;

    const current = audioRef.current.currentTime;
    setCurrentTime(current);
    onTimeUpdate?.(current);
  };

  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    setDuration(audioRef.current.duration);
  };

  const handleSeek = (value: number[]) => {
    if (!audioRef.current) return;
    const time = value[0];
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleVolumeChange = (value: number[]) => {
    if (!audioRef.current) return;
    const vol = value[0];
    audioRef.current.volume = vol;
    setVolume(vol);
    setIsMuted(vol === 0);
  };

  const toggleMute = () => {
    if (!audioRef.current) return;

    if (isMuted) {
      audioRef.current.volume = volume;
      setIsMuted(false);
    } else {
      audioRef.current.volume = 0;
      setIsMuted(true);
    }
  };

  const skip = (seconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Math.min(duration, currentTime + seconds));
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";

    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  if (!src) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="text-center text-muted-foreground">
            <p className="mb-2">No audio available</p>
            <p className="text-sm">{title}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <audio
          ref={audioRef}
          src={src}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
        />

        {/* Title */}
        <div className="mb-4">
          <h3 className="font-medium text-sm line-clamp-1">{title}</h3>
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <Slider value={[currentTime]} max={duration || 100} step={1} onValueChange={handleSeek} className="mb-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => skip(-10)} disabled={!src}>
              <SkipBack className="h-4 w-4" />
            </Button>

            <Button variant="ghost" size="sm" onClick={handlePlayPause} disabled={!src}>
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>

            <Button variant="ghost" size="sm" onClick={() => skip(10)} disabled={!src}>
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>

          {/* Volume Control */}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={toggleMute} disabled={!src}>
              {isMuted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
            <div className="w-16">
              <Slider
                value={[isMuted ? 0 : volume]}
                max={1}
                step={0.1}
                onValueChange={handleVolumeChange}
                disabled={!src}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
