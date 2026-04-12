# TerrainSN - Plateforme de Réservation de Terrains de Sport

## 🚀 Déploiement sur Vercel

### Prérequis

1. Un compte GitHub avec le repo cloner
2. Un compte Vercel (gratuit sur vercel.com)
3. Node.js v18+ installé localement

### Instructions de Déploiement

#### 1. Préparation du Repo GitHub
```bash
# Assurez-vous que votre repo GitHub est à jour
git add .
git commit -m "Optimizations for Vercel deployment"
git push origin main
```

#### 2. Déployer sur Vercel
1. Accédez à [vercel.com](https://vercel.com)
2. Cliquez sur "New Project"
3. Importez votre repo GitHub (galsencode12/TerrainSN1)
4. Vercel détectera Vite automatiquement
5. Configurez les variables d'environnement:
   - `VITE_API_URL`: URL de votre API backend

#### 3. Configuration des Variables d'Environnement

Dans le dashboard Vercel, allez dans `Settings → Environment Variables` et ajoutez:

```
VITE_API_URL=https://your-api-url.com/api
```

### 📋 Configuration Actuelle

- **Framework**: Vite + React
- **Build Output**: `dist/`
- **build command**: `npm run build`
- **dev command**: `npm run dev`

### ⚡ Optimisations Appliquées

✅ Minification CSS et JS  
✅ Code splitting automatique  
✅ Sourcemaps désactivées en production  
✅ Console logs supprimées en production  
✅ Images optimisées  
✅ Support des variables d'environnement VITE_*  

### 🔧 Variables d'Environnement

Créez un fichier `.env.local` pour le développement:

```
VITE_API_URL=http://localhost:3001/api
```

### 📦 Installation et Exécution Locale

```bash
# Installation des dépendances
npm install

# Développement
npm run dev

# Build de production
npm run build

# Preview du build
npm run preview
```

### 🐛 Dépannage Vercel

**Problème**: "Build failed"
- Vérifiez que tous les scripts npm sont corrects
- Vérifiez les variables d'environnement
- Consultez les logs Vercel pour plus de détails

**Problème**: "API calls failing"
- Assurez-vous que `VITE_API_URL` est correctement configurée
- Vérifiez les CORS headers de votre backend
- Testez la connexion API avec curl

### 📝 Notes Importantes

1. Le backend (serveur Node.js) doit être hébergé séparément (Heroku, Railway, etc.)
2. Les CORS doivent être configurés correctement dans le backend
3. Mongo DB ou autre base de données doit être accessible depuis le backend

### 🔗 Ressources

- [Documentation Vercel](https://vercel.com/docs)
- [Documentation Vite](https://vitejs.dev)
- [React Documentation](https://react.dev)
