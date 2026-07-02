// Error handler pour Vercel
// Gère les erreurs globales et les logs

interface ErrorLog {
  message: string;
  stack?: string;
  timestamp: string;
  context?: string;
}

const errorLogs: ErrorLog[] = [];
const MAX_LOGS = 50;

export function logError(error: Error | string, context?: string) {
  const errorLog: ErrorLog = {
    message: typeof error === 'string' ? error : error.message,
    stack: typeof error === 'string' ? undefined : error.stack,
    timestamp: new Date().toISOString(),
    context,
  };

  errorLogs.push(errorLog);
  
  // Garder seulement les derniers 50 logs
  if (errorLogs.length > MAX_LOGS) {
    errorLogs.shift();
  }

  // Log en développement
  if (import.meta.env.DEV) {
    console.error(`[${context || 'Unknown'}]`, error);
  }

  // En production, on peut envoyer les logs à un service
  if (import.meta.env.PROD && errorLogs.length % 10 === 0) {
    // Envoyer les logs à un service backend
    sendErrorLogs();
  }
}

export function getErrorLogs(): ErrorLog[] {
  return [...errorLogs];
}

async function sendErrorLogs() {
  try {
    // À implémenter: envoyer les logs à votre service de monitoring
    // await fetch('/api/logs', { method: 'POST', body: JSON.stringify(errorLogs) });
  } catch (err) {
    console.error('Failed to send error logs:', err);
  }
}

// Capturer les erreurs non gérées
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    logError(event.error, 'uncaughtError');
  });

  window.addEventListener('unhandledrejection', (event) => {
    logError(event.reason, 'unhandledRejection');
  });
}

export default { logError, getErrorLogs };
