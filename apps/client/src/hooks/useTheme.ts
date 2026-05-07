import { useEffect } from "react";
import { useTheme as useThemeState, useAppStore } from "@/stores/useAppStore";

/**
 * Hook that syncs the theme state with the DOM.
 * Dark mode is currently disabled product-wide — this hook forces light mode
 * and migrates any persisted "dark" preference back to "light" for old users.
 * Should be called once at the app root level.
 */
export function useThemeEffect() {
  const theme = useThemeState();
  const setTheme = useAppStore((state) => state.setTheme);

  useEffect(() => {
    if (theme === "dark") {
      setTheme("light");
    }
    document.documentElement.classList.remove("dark");
  }, [theme, setTheme]);

  return theme;
}

/**
 * Hook to get the current theme and toggle function.
 */
export function useThemeToggle() {
  const theme = useThemeState();
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const setTheme = useAppStore((state) => state.setTheme);

  return {
    theme,
    toggleTheme,
    setTheme,
    isDark: theme === "dark",
  };
}
