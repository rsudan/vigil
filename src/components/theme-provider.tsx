import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { readTheme, writeTheme } from "@/lib/session-keys";

type Theme = "light" | "dark";
const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({
  theme: "light",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const initial = readTheme();
    setThemeState(initial);
    writeTheme(initial);
  }, []);

  function setTheme(next: Theme) {
    setThemeState(next);
    writeTheme(next);
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- tiny hook that belongs with its provider
export function useTheme() {
  return useContext(ThemeContext);
}
