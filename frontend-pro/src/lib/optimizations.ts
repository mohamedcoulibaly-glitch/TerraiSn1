// Optimisations pour Vercel
// Ce fichier contient des configurations pour optimiser les performances

export const OPTIMIZATION_HINTS = {
  // Lazy load des composants lourds
  lazyLoad: true,
  
  // Cache des requêtes API (en secondes)
  cacheTime: 300,
  
  // Limite du nombre de requêtes simultanées
  maxConcurrentRequests: 3,
  
  // Optimiser les images
  imageOptimization: {
    quality: 75,
    formats: ['webp', 'jpeg'],
  },
};

// Configuration pour React Query
export const REACT_QUERY_CONFIG = {
  queries: {
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    retry: 1,
    refetchOnWindowFocus: false,
    networkMode: 'offlineFirst' as const,
  },
  mutations: {
    retry: 1,
    networkMode: 'offlineFirst' as const,
  },
};

export default OPTIMIZATION_HINTS;
