import { useEffect } from "react";
import { useTheme as useThemeState, useAppStore } from "@/stores/useAppStore";

/**
 * Hook that syncs the theme state with the DOM.
 * Applies the 'dark' class to document.documentElement when theme is 'dark'.
 * Should be called once at the app root level.
 */
export function useThemeEffect() {
  const theme = useThemeState();

  useEffect(() => {
    const root = document.documentElement;

    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

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
