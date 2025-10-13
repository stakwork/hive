"use client";

import { useTheme as useNextTheme } from "../providers/theme-provider";
import { useEffect, useMemo, useState } from "react";

export function useTheme() {
  const { theme, setTheme } = useNextTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const resolvedTheme = useMemo(() => {
    if (!mounted) return "light";
    if (theme !== "system") return theme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }, [mounted, theme]);

  const toggleTheme = () => {
    setTheme(resolvedTheme === "light" ? "dark" : "light");
  };

  return {
    theme: resolvedTheme,
    setTheme,
    toggleTheme,
    mounted,
  };
}
