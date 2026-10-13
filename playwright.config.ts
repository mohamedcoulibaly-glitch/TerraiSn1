import { defineConfig, devices } from "@playwright/test";

/**
 * E2E TerrainSN — specs actuelles encore monolithe (joueur + backoffice même origine).
 * Par défaut : legacy `frontend/` sur :8080 pour éviter de casser les parcours mixtes.
 *
 * Migration prévue :
 *   E2E_BASE_URL=http://127.0.0.1:5173  → frontend-joueur
 *   E2E_PRO_URL=http://127.0.0.1:5174   → frontend-pro
 *
 * API réelle : E2E_API_URL=http://localhost:3001/api npx playwright test
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:8080",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "fr-FR",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    // Legacy monolithe tant que e2e/ n'est pas scindé joueur/pro
    command: "npm run dev --prefix frontend -- --host 127.0.0.1 --port 8080",
    url: "http://127.0.0.1:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_API_URL: process.env.E2E_API_URL || "/api",
    },
  },
});
