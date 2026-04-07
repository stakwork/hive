import type { Graph, GraphNode, ViewState } from "./types";

interface NodeDetailPanelProps {
  node: GraphNode;
  graph: Graph;
  viewState: ViewState;
  onClose: () => void;
  onNavigate: (nodeId: number) => void;
}

const panelStyle: React.CSSProperties = {
  width: 640,
  maxHeight: 480,
  background: "rgba(5, 8, 18, 0.92)",
  backdropFilter: "blur(20px)",
  border: "1px solid rgba(77, 217, 232, 0.3)",
  borderRadius: 16,
  boxShadow:
    "0 0 30px rgba(77, 217, 232, 0.08), 0 0 60px rgba(77, 217, 232, 0.04), inset 0 1px 0 rgba(255,255,255,0.04)",
  fontFamily: "'Barlow', sans-serif",
  color: "#e0e6f0",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  userSelect: "none",
};

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

export function NodeDetailPanel({
  node,
  graph,
  viewState,
  onClose,
  onNavigate,
}: NodeDetailPanelProps) {
  const depth =
    viewState.mode === "subgraph"
      ? node.id === viewState.selectedNodeId
        ? 0
        : (viewState.depthMap.get(node.id) ?? null)
      : null;

  // Depth-1 neighbors
  const neighbors = graph.adj[node.id]
    ?.map((id) => graph.nodes[id])
    .filter(Boolean) ?? [];

  const isExecuting = node.status === "executing";

  return (
    <div
      style={panelStyle}
      onWheel={stopPropagation}
      onPointerDown={stopPropagation}
      onPointerUp={stopPropagation}
      onPointerMove={stopPropagation}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "16px 20px 12px",
          borderBottom: "1px solid rgba(77, 217, 232, 0.12)",
        }}
      >
        {node.icon && (
          <span style={{ fontSize: 22, lineHeight: 1 }}>{node.icon}</span>
        )}
        <span
          style={{
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: "0.3px",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {node.label}
        </span>
        {isExecuting && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 6,
              background: "rgba(0, 255, 100, 0.12)",
              border: "1px solid rgba(0, 255, 100, 0.4)",
              color: "rgba(0, 255, 100, 0.95)",
              textShadow: "0 0 6px rgba(0,255,100,0.4)",
            }}
          >
            EXECUTING
          </span>
        )}
        <button
          onClick={onClose}
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.05)",
            color: "#888",
            fontSize: 14,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {"\u2715"}
        </button>
      </div>

      {/* Metadata grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 1,
          padding: "0 20px",
          margin: "12px 0",
        }}
      >
        <MetaItem
          label="Status"
          value={node.status ?? "idle"}
          color={
            isExecuting
              ? "rgba(0,255,100,0.9)"
              : node.status === "done"
                ? "rgba(77,217,232,0.9)"
                : "rgba(255,255,255,0.5)"
          }
        />
        <MetaItem
          label="Progress"
          value={
            node.progress != null
              ? `${Math.round(node.progress * 100)}%`
              : "--"
          }
          color={isExecuting ? "rgba(0,255,100,0.9)" : undefined}
        />
        <MetaItem label="Degree" value={String(node.degree)} />
        <MetaItem
          label="Depth"
          value={depth !== null ? String(depth) : "--"}
        />
      </div>

      {/* Content */}
      {node.content && (
        <div
          style={{
            padding: "0 20px",
            marginBottom: 12,
            maxHeight: 140,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.6,
              color: "rgba(224, 230, 240, 0.75)",
            }}
          >
            {node.content}
          </div>
        </div>
      )}

      {/* Neighbors */}
      {neighbors.length > 0 && (
        <div style={{ padding: "0 20px", marginBottom: 12 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.8px",
              color: "rgba(77, 217, 232, 0.6)",
              marginBottom: 8,
            }}
          >
            Neighbors
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {neighbors.map((n) => (
              <button
                key={n.id}
                onClick={() => onNavigate(n.id)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(77, 217, 232, 0.25)",
                  background: "rgba(77, 217, 232, 0.06)",
                  color: "rgba(77, 217, 232, 0.85)",
                  fontSize: 12,
                  fontFamily: "'Barlow', sans-serif",
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "background 0.15s, border-color 0.15s",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background =
                    "rgba(77, 217, 232, 0.15)";
                  e.currentTarget.style.borderColor =
                    "rgba(77, 217, 232, 0.5)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background =
                    "rgba(77, 217, 232, 0.06)";
                  e.currentTarget.style.borderColor =
                    "rgba(77, 217, 232, 0.25)";
                }}
              >
                {n.icon ? `${n.icon} ` : ""}
                {n.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Footer hint */}
      <div
        style={{
          padding: "10px 20px",
          borderTop: "1px solid rgba(77, 217, 232, 0.08)",
          textAlign: "center",
          fontSize: 11,
          color: "rgba(255,255,255,0.25)",
          letterSpacing: "0.3px",
        }}
      >
        zoom out or press Esc to exit
      </div>
    </div>
  );
}

function MetaItem({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.6px",
          color: "rgba(255,255,255,0.35)",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: color ?? "rgba(255,255,255,0.8)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
