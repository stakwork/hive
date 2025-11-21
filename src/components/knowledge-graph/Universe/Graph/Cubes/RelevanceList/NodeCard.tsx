import { MediaPlayer } from "@/components/calls/MediaPlayer";
import { useSchemaStore } from "@/stores/useSchemaStore";
import { NodeExtended } from "@Universe/types";
import { NodeDetail } from "./NodeDetail";

interface NodeCardProps {
  node: NodeExtended;
  compact?: boolean;
  onClick?: (node: NodeExtended) => void;
}

export const NodeCard = ({ node, compact = false, onClick }: NodeCardProps) => {
  const { normalizedSchemasByType } = useSchemaStore((s) => s);

  const nodeSchema = normalizedSchemasByType[node.node_type];
  const nodeColor = nodeSchema?.primary_color || "#6b7280";

  const getDisplayName = (node: NodeExtended) => {
    return (
      node.name || node.properties?.name || node.properties?.title || node.properties?.text || `${node.node_type} Node`
    );
  };

  const getImageUrl = (node: NodeExtended) => {
    return node.properties?.image_url as string | undefined;
  };

  const getSourceLink = (node: NodeExtended) => {
    return node.properties?.source_link as string | undefined;
  };

  const getMediaUrl = (node: NodeExtended) => {
    return node.properties?.media_url as string | undefined;
  };

  const hasImage = !!getImageUrl(node);
  const mediaUrl = getMediaUrl(node);
  const sourceLink = getSourceLink(node);
  const properties = node.properties || {};

  // Filter out certain system properties and object properties that shouldn't be displayed
  const filteredProperties = Object.entries(properties).filter(
    ([key, value]) => !["image_url", "source_link", "media_url", "audio_EN"].includes(key) && typeof value !== "object",
  );

  if (compact) {
    return (
      <div
        className={`p-3 bg-gray-800/50 rounded border border-gray-600 hover:bg-gray-700/50 transition-colors ${
          onClick ? "cursor-pointer" : ""
        }`}
        onClick={() => onClick?.(node)}
      >
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: nodeColor }} />
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{node.node_type}</span>
          {sourceLink && (
            <a
              href={sourceLink}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-gray-400 hover:text-gray-200 text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              🔗
            </a>
          )}
        </div>
        <div className="text-sm font-medium text-white truncate mb-1">{getDisplayName(node)}</div>
        <div className="text-xs text-gray-400 space-y-1">
          {filteredProperties.slice(0, 2).map(([key, value]) => (
            <NodeDetail key={key} label={key} value={value} compact />
          ))}
          {filteredProperties.length > 2 && (
            <div className="text-xs text-gray-500">+{filteredProperties.length - 2} more properties</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="text-white bg-black/95 backdrop-blur-sm rounded-lg border border-gray-700 overflow-hidden flex flex-col">
      {/* Media Section - MediaPlayer takes priority over regular image */}
      {mediaUrl ? (
        <div className="w-full p-4 bg-gray-900/50">
          <MediaPlayer
            src={mediaUrl}
            title={getDisplayName(node)}
            imageUrl={getImageUrl(node)}
            className="w-full"
            showExpandButton={false}
          />
        </div>
      ) : (
        hasImage && (
          <div className="w-full h-48 p-4 flex justify-center items-center bg-gray-900/50">
            <img
              src={getImageUrl(node)}
              alt="Node content"
              className="max-w-full max-h-full object-contain rounded"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          </div>
        )
      )}

      {/* Content Section */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Header */}
        <div className="mb-4 pb-3 border-b border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: nodeColor }} />
            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{node.node_type}</span>
            {sourceLink && (
              <a
                href={sourceLink}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-gray-400 hover:text-gray-200 text-xs"
              >
                🔗 Source
              </a>
            )}
          </div>
          <h3 className="text-lg font-semibold text-white leading-tight">{getDisplayName(node)}</h3>
          {node.ref_id && <p className="text-xs text-gray-500 mt-1 font-mono truncate">ID: {node.ref_id}</p>}
        </div>

        {/* Properties */}
        <div className="space-y-1">
          {filteredProperties.length > 0 ? (
            filteredProperties.map(([key, value]) => <NodeDetail key={key} label={key} value={value} />)
          ) : (
            <div className="text-sm text-gray-400 text-center py-4">No additional properties available</div>
          )}
        </div>

        {/* Node Metadata */}
        <div className="mt-4 pt-3 border-t border-gray-700/50 text-xs text-gray-500 space-y-1">
          {node.edge_count !== undefined && <div>Connections: {node.edge_count}</div>}
          {node.properties?.weight && <div>Weight: {node.properties.weight}</div>}
          {node.x !== undefined && (
            <div className="font-mono">
              Position: ({node.x.toFixed(1)}, {node.y?.toFixed(1)}, {node.z?.toFixed(1)})
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
