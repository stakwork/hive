import React from "react";

type Size = string | number;

interface IframeProps {
  src: string;
  title?: string;
  width?: Size; // "100%" | "600px" | 600
  height?: Size; // "100%" | "400px" | 400
  allowFullScreen?: boolean;
  className?: string;
  frameProps?: React.IframeHTMLAttributes<HTMLIFrameElement>;
}

function sizeToCss(s?: Size) {
  if (s === undefined) return undefined;
  return typeof s === "number" ? `${s}px` : s;
}

export const Iframe: React.FC<IframeProps> = ({
  src,
  title = "Embedded content",
  width = "100%",
  height = "500px",
  allowFullScreen = true,
  className = "",
  frameProps = {},
}) => {
  const cssWidth = sizeToCss(width);
  const cssHeight = sizeToCss(height);

  return (
    // apply explicit width/height to wrapper so "100%" on iframe has a reference
    <div
      className={`overflow-hidden rounded-2xl ${className}`}
      style={{
        width: cssWidth,
        height: cssHeight,
        minHeight: cssHeight ? undefined : 150, // optional fallback
      }}
    >
      <iframe
        src={src}
        title={title}
        // keep attributes for legacy embed consumers, but use inline style as authoritative
        width={cssWidth}
        height={cssHeight}
        allowFullScreen={allowFullScreen}
        loading="lazy"
        // style uses the actual CSS size values we computed
        style={{
          border: "none",
          width: "100%",
          height: "100%",
          display: "block",
        }}
        {...frameProps}
      />
    </div>
  );
};
