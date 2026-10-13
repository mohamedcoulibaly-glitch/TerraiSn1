import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);
const THEME_KEY = 'theme-preference';
const LEGACY_THEME_KEY = 'theme';

function readStoredTheme() {
  if (typeof window === 'undefined') return 'light';
  const explicit = localStorage.getItem(THEME_KEY) || localStorage.getItem(LEGACY_THEME_KEY);
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return 'light';
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readStoredTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem(THEME_KEY, theme);
    localStorage.setItem(LEGACY_THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const resetToSystem = () => {
    localStorage.removeItem(THEME_KEY);
    localStorage.removeItem(LEGACY_THEME_KEY);
    setTheme('light');
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, resetToSystem, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
};
