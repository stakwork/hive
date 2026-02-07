"use client";

import { ReactNode } from "react";
import { CopyableText } from "./CopyableText";

interface PodPasswordWrapperProps {
  children: ReactNode;
}

/**
 * Component that wraps text content and makes pod passwords copyable
 * Detects patterns like "Pod Password: <PASSWORD>" and wraps the password with CopyableText
 */
export function PodPasswordWrapper({ children }: PodPasswordWrapperProps) {
  // If children is not a string, return as-is
  if (typeof children !== "string") {
    return <>{children}</>;
  }

  // Pattern to match "Pod Password: <password_value>"
  const podPasswordPattern = /Pod Password:\s*(.+?)(?=\n|$)/gi;
  const matches = Array.from(children.matchAll(podPasswordPattern));

  // If no matches, return original content
  if (matches.length === 0) {
    return <>{children}</>;
  }

  // Split the text and wrap password values
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  matches.forEach((match, index) => {
    const matchStart = match.index!;
    const matchEnd = matchStart + match[0].length;
    const password = match[1].trim();
    const prefixEnd = matchStart + match[0].indexOf(password);

    // Add text before this match
    if (matchStart > lastIndex) {
      parts.push(children.substring(lastIndex, matchStart));
    }

    // Add "Pod Password: " prefix
    parts.push(children.substring(matchStart, prefixEnd));

    // Add copyable password
    parts.push(
      <CopyableText key={`password-${index}`} text={password}>
        {password}
      </CopyableText>
    );

    lastIndex = matchEnd;
  });

  // Add remaining text
  if (lastIndex < children.length) {
    parts.push(children.substring(lastIndex));
  }

  return <>{parts}</>;
}
