/** @type {import('@lhci/cli').LighthouseCIConfig} */
module.exports = {
  ci: {
    collect: {
      startServerCommand: 'npm run preview -- --port 4173 --host 127.0.0.1',
      startServerReadyPattern: 'Local',
      startServerReadyTimeout: 90000,
      url: [
        'http://127.0.0.1:4173/',
        'http://127.0.0.1:4173/explorer',
      ],
      numberOfRuns: 1,
      settings: {
        chromeFlags: '--no-sandbox --headless=new',
      },
    },
    assert: {
      // Lighthouse 10+ n'expose plus les audits PWA (installable-manifest, etc.).
      // L'installabilité est couverte par scripts/audit-pwa.mjs dans le workflow CI.
      assertions: {
        'categories:performance': ['warn', { minScore: 0.5 }],
        'categories:accessibility': ['warn', { minScore: 0.8 }],
        'categories:best-practices': ['warn', { minScore: 0.8 }],
        'viewport': ['error', { minScore: 1 }],
        'document-title': ['warn', { minScore: 1 }],
        'meta-description': ['warn', { minScore: 1 }],
        'is-on-https': 'off',
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
