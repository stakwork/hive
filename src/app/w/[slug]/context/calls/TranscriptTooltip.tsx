import { ReactNode, useState } from "react";

interface TranscriptTooltipProps {
  children: ReactNode;
  transcript: string;
  show: boolean;
}

export function TranscriptTooltip({ children, transcript, show }: TranscriptTooltipProps) {
  const [isHovered, setIsHovered] = useState(false);

  const displayText = transcript.length > 200 ? `...${transcript.slice(-170)}` : transcript;

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {children}
      {show && isHovered && displayText.trim() && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 pointer-events-none">
          <div className="bg-popover text-popover-foreground px-3 py-2 rounded-md shadow-md border-2 border-border w-96 min-h-[4.5rem]">
            <p className="text-xs font-mono whitespace-pre-wrap break-words">{displayText}</p>
          </div>
        </div>
      )}
    </div>
  );
}
