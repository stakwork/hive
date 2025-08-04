"use client";

import { useTheme as useNextTheme } from "../providers/theme-provider";
import { useEffect, useState } from "react";

export function useTheme() {
  const { theme, setTheme } = useNextTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light");
  };

  const resolvedTheme = mounted ? theme : "light";

  return {
    theme: resolvedTheme,
    setTheme,
    toggleTheme,
    mounted,
  };
}
