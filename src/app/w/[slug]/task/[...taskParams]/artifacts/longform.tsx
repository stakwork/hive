import { LongformContent, Artifact } from "@/lib/chat";
import { useRef, useState, useEffect } from "react";

export function LongformArtifactPanel({
  artifacts,
}: {
  artifacts: Artifact[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showFade, setShowFade] = useState(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handle = () => {
      setShowFade(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
    };
    el.addEventListener("scroll", handle);
    handle();
    return () => el.removeEventListener("scroll", handle);
  }, [artifacts]);

  if (artifacts.length === 0) return null;

  return (
    <div className="h-full flex flex-col relative">
      <div
        ref={scrollRef}
        className="bg-background/50 border rounded-lg p-4 max-h-80 overflow-auto text-sm whitespace-pre-wrap relative"
      >
        {artifacts.map((artifact) => {
          const content = artifact.content as LongformContent;
          return (
            <div key={artifact.id}>
              {content.title && (
                <div className="font-semibold text-lg mb-2">
                  {content.title}
                </div>
              )}
              <div>{content.text}</div>
            </div>
          );
        })}
      </div>
      {showFade && (
        <div className="pointer-events-none absolute left-0 right-0 bottom-0 h-8 bg-gradient-to-b from-transparent to-background" />
      )}
    </div>
  );
}
