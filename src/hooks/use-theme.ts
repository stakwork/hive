"use client";

import { useTheme as useNextTheme } from "../providers/theme-provider";
import { useEffect, useState } from "react";

export function useTheme() {
  const { theme, setTheme } = useNextTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const resolvedTheme = (() => {
    if (!mounted) return "light";
    if (theme !== "system") return theme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  })();

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
