import { NodeExtended } from "@Universe/types";

export const CalloutLabel = ({
    node,
    title,
    _baseColor = '#7DDCFF',
    onHover,
    onUnhover,
    onClick
}: {
    node?: NodeExtended;
    title: string;
    baseColor?: string;
    onHover?: (node: NodeExtended) => void;
    onUnhover?: () => void;
    onClick?: (nodeId: string) => void;
}) => {
    const labelHeight = 32;
    const lineLength = 60;
    const maxWidth = 250;
    const minWidth = 80;

    const displayTitle = title.slice(0, 60);

    const onPointerOver = () => {
        if (node && onHover) onHover(node);
    }

    const onPointerOut = () => {
        if (onUnhover) onUnhover();
    }

    const onPointerClick = () => {
        if (node && onClick) onClick(node.ref_id);
    }

    return (
        <div
            className="relative pointer-events-auto select-none"
            onMouseEnter={onPointerOver}
            onMouseLeave={onPointerOut}
            onClick={onPointerClick}
        >
            {/* Simple line from center (node) to center-left of label */}
            <svg
                className="absolute top-0 left-0 overflow-visible pointer-events-none"
                style={{ zIndex: -1 }}
            >
                <line
                    x1="0"
                    y1="0"
                    x2={lineLength}
                    y2={-labelHeight / 2}
                    stroke="#666"
                    strokeWidth="1"
                    opacity="0.6"
                />
            </svg>

            {/* Label box */}
            <div
                className="absolute bg-gray-900/20 rounded px-3 py-2 backdrop-blur-sm"
                style={{
                    left: `${lineLength}px`,
                    top: `${-labelHeight}px`,
                    minWidth: `${minWidth}px`,
                    maxWidth: `${maxWidth}px`,
                    minHeight: `${labelHeight}px`,
                }}
            >
                <div className="text-[#fed106] text-xs font-medium whitespace-nowrap">
                    {displayTitle}
                </div>
            </div>
        </div>
    );
};