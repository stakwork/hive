import { LongformContent, Artifact } from "@/lib/chat";


export function LongformArtifactPanel({
  artifacts,
}: {
  artifacts: Artifact[];
}) {
  if (artifacts.length === 0) return null;

  return (
    <div className="h-full flex flex-col">
      {artifacts.map((artifact) => {
        const content = artifact?.content as LongformContent;
        return (
          <div key={artifact.id} className="p-4">
            {content.title && (
              <div className="font-semibold text-lg mb-2">{content.title}</div>
            )}
            <div className="bg-background/50 border rounded-lg p-4 max-h-80 overflow-auto text-sm whitespace-pre-wrap">
              {content.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}
