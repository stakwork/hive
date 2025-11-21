"use client";

import { useTheme } from "@/hooks/use-theme";

export function getGitHubIconPath(isDark: boolean): string {
  return isDark ? "/svg-icons/Github-dark.svg" : "/svg-icons/Github-light.svg";
}

export function GitHubIcon() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const iconPath = getGitHubIconPath(isDark);

  return <img src={iconPath} alt="GitHub" className="inline-block w-4 h-4 mr-1 align-text-bottom" />;
}
