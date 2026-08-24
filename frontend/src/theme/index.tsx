import React, { createContext, useContext, useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import { storage } from "@/src/utils/storage";

export const FONT = {
  display: "Outfit",
  text: "Figtree",
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const RADIUS = {
  sm: 6,
  md: 12,
  lg: 20,
  xl: 24,
  pill: 999,
};

export type ThemeMode = "light" | "dark";

export type Palette = {
  surface: string;
  onSurface: string;
  surfaceSecondary: string;
  onSurfaceSecondary: string;
  surfaceTertiary: string;
  onSurfaceTertiary: string;
  brand: string;
  onBrand: string;
  success: string;
  warning: string;
  error: string;
  onError: string;
  border: string;
  borderStrong: string;
  tileStudio: string;
  tileNotes: string;
  tileSocial: string;
  tileChat: string;
  onTileDark: string;
  onTileLight: string;
};

const LIGHT: Palette = {
  surface: "#F7F7F7",
  onSurface: "#1C1C1E",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#1C1C1E",
  surfaceTertiary: "#E5E5EA",
  onSurfaceTertiary: "#8E8E93",
  brand: "#2D6A4F",
  onBrand: "#FFFFFF",
  success: "#40916C",
  warning: "#E9C46A",
  error: "#C92A42",
  onError: "#FFFFFF",
  border: "#E5E5EA",
  borderStrong: "#C7C7CC",
  tileStudio: "#2D6A4F",
  tileNotes: "#D4A373",
  tileSocial: "#8F9E8B",
  tileChat: "#C92A42",
  onTileDark: "#1C1C1E",
  onTileLight: "#FFFFFF",
};

const DARK: Palette = {
  surface: "#121212",
  onSurface: "#F7F7F7",
  surfaceSecondary: "#1E1E1E",
  onSurfaceSecondary: "#F7F7F7",
  surfaceTertiary: "#2C2C2E",
  onSurfaceTertiary: "#98989D",
  brand: "#40916C",
  onBrand: "#0A0A0A",
  success: "#52B788",
  warning: "#F4A261",
  error: "#FF4D6D",
  onError: "#121212",
  border: "#2C2C2E",
  borderStrong: "#48484A",
  tileStudio: "#40916C",
  tileNotes: "#E9C46A",
  tileSocial: "#A3B19B",
  tileChat: "#FF4D6D",
  onTileDark: "#121212",
  onTileLight: "#FFFFFF",
};

type ThemeCtx = {
  colors: Palette;
  mode: ThemeMode;
  isDark: boolean;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
};

const Ctx = createContext<ThemeCtx | null>(null);
const THEME_KEY = "theme_mode";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(system === "dark" ? "dark" : "light");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const saved = await storage.getItem<ThemeMode>(THEME_KEY, "");
      if (saved === "light" || saved === "dark") setModeState(saved);
      setLoaded(true);
    })();
  }, []);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    storage.setItem(THEME_KEY, m);
  };

  const toggle = () => setMode(mode === "dark" ? "light" : "dark");

  const value: ThemeCtx = {
    colors: mode === "dark" ? DARK : LIGHT,
    mode,
    isDark: mode === "dark",
    setMode,
    toggle,
  };

  if (!loaded) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTheme must be used within ThemeProvider");
  return c;
}
