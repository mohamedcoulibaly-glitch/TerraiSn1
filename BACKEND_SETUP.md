# Backend API Configuration pour Vercel

## Options d'Hébergement du Backend

Comme Vercel ne supporte pas les serveurs Node.js traditionnels, vous avez plusieurs options:

### Option 1: Railway (Recommandé)
- **URL**: https://railway.app
- **Coût**: À partir de $5/mois
- **Setup**: 
  1. Créez un compte Railway
  2. Connectez votre repo GitHub
  3. Railway détecte automatiquement Node.js
  4. Variables d'environnement: `PORT=3001`, `DATABASE_URL`, etc.
  5. URL fournie automatiquement: `https://your-app.railway.app`

### Option 2: Render
- **URL**: https://render.com
- **Coût**: Gratuit (avec limitations)
- **Setup**:
  1. Connectez votre repo GitHub
  2. Sélectionnez "Web Service"
  3. Runtime: Node
  4. Configurez les variables d'environnement
  5. Déployer

### Option 3: Heroku (payant)
- **URL**: https://www.heroku.com
- **Coût**: À partir de $7/mois
- **Setup**: Utilisez Heroku CLI

### Option 4: Vercel Serverless Functions (Avancé)
- Convertir le backend en API Routes Vercel
- Utiliser `/api` directory
- Functions timeout: 10s gratuit, 300s payant

## Configuration PostgreSQL/MongoDB

Vous devrez aussi héberger votre base de données:

### Option A: PostgreSQL avec Railway
```bash
# Dans Railway, ajouter PostgreSQL
DATABASE_URL=postgresql://user:password@host:5432/database
```

### Option B: MongoDB Atlas (Gratuit)
- **URL**: https://www.mongodb.com/cloud/atlas
- **Setup**: Gratuit jusqu'à 512MB
- Récupérez votre connection string

### Option C: SQLite (Non recommandé pour production)
- Actuellement utilisé pour le développement
- Non recommandé pour Vercel (stockage éphémère)

## Configuration CORS pour Vercel

Votre backend doit accepter les requêtes depuis votre domaine Vercel:

```javascript
// server/index.js
app.use(cors({
  origin: [
    'https://terrainsn.vercel.app',
    'https://www.terrainsn.com',
    'http://localhost:3000',
  ],
  credentials: true,
}));
```

## Variables d'Environnement

Utilisez les variables d'environnement pour les URLs:

**Frontend (.env.production)**:
```
VITE_API_URL=https://your-api.railway.app/api
```

**Backend (.env)**:
```
DATABASE_URL=postgresql://...
JWT_SECRET=your-secret-key
PORT=3001
NODE_ENV=production
```

## Health Check pour Vercel

Ajoutez un route de health check:

```javascript
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});
```

## Checklist Déploiement

- [ ] Backend déployé sur Railway/Render
- [ ] Base de données configurée
- [ ] CORS configuré pour votre domaine Vercel
- [ ] Variables d'environnement définies
- [ ] `VITE_API_URL` pointe vers votre backend
- [ ] Health check endpoint fonctionne
- [ ] Tests en production effectués

## Commandes Utiles

```bash
# Test la connexion API
curl https://your-api.railway.app/api/health

# Vérifier les variables d'environnement Vercel
vercel env pull .env.local

# Build local
npm run build

# Test du build localement
npm run preview
```

## Support et Dépannage

- **Les appels API échouent**: Vérifiez CORS et `VITE_API_URL`
- **Erreurs de base de données**: Vérifiez `DATABASE_URL`
- **Timeout**: Vérifiez les performance du backend
