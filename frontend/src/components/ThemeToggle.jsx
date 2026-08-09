import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';

export const ThemeToggle = ({ className = '' }) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Passer en mode clair' : 'Passer en mode sombre'}
      aria-pressed={isDark}
      className={`
        relative inline-flex h-7 w-14 shrink-0 items-center rounded-full border p-0.5
        transition-colors duration-300
        ${isDark
          ? 'bg-[var(--primary)] border-[var(--primary)]'
          : 'bg-[var(--surface-2)] border-[var(--border-strong)]'
        }
        ${className}
      `}
    >
      <span
        className={`
          pointer-events-none flex h-6 w-6 items-center justify-center rounded-full shadow-md
          transition-transform duration-300 ease-out will-change-transform
          ${isDark
            ? 'translate-x-7 bg-[var(--bg)]'
            : 'translate-x-0 bg-white'
          }
        `}
      >
        {isDark
          ? <Moon className="h-3.5 w-3.5 text-[var(--primary)]" />
          : <Sun className="h-3.5 w-3.5 text-[var(--accent)]" />
        }
      </span>
    </button>
  );
};

export default ThemeToggle;
