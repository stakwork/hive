import React from "react";
import { getAllowedDomains, isAllowedDomain } from "@/lib/utils/url-validator";

type Size = string | number;

interface IframeProps {
  src: string;
  title?: string;
  width?: Size;   // "100%" | "600px" | 600
  height?: Size;  // "100%" | "400px" | 400
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

  // Validate iframe src against domain allowlist
  const allowedDomains = getAllowedDomains();
  const isDomainAllowed = isAllowedDomain(src, allowedDomains);

  if (!isDomainAllowed) {
    console.warn(`[Security] Blocked iframe src from disallowed domain: ${src}`);
    return (
      <div
        className={`overflow-hidden rounded-2xl ${className} flex items-center justify-center bg-muted`}
        style={{
          width: cssWidth,
          height: cssHeight,
          minHeight: cssHeight ? undefined : 150,
        }}
      >
        <p className="text-muted-foreground text-sm px-4 text-center">
          Content blocked: Domain not in allowlist
        </p>
      </div>
    );
  }

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
