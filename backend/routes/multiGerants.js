/**
 * Routes multi-gérants — admin + gérant
 */
const express = require('express');
const { authMiddleware, requireRole, resolveTerrainGerant } = require('../middleware/auth');
const gerantService = require('../services/gerantService');

function actorMeta(req) {
  const role = req.user?.role === 'superadmin' ? 'super_admin' : req.user?.role;
  return { fait_par: req.user?.id, role_fait_par: role || 'super_admin' };
}

function registerAdminGerantsRoutes(router) {
  // GET /admin/terrains/:id/gerants
  router.get('/terrains/:id/gerants', async (req, res) => {
    try {
      const terrainId = Number(req.params.id);
      const gerants = await gerantService.getGerantsTerrain(terrainId, { inclureInactifs: true });
      const garde = await gerantService.getGerantDeGarde(terrainId);
      const planning = await gerantService.listPlanningGerant(terrainId);
      res.json({ gerants, garde_actuelle: garde, planning });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // GET /admin/terrains/:id/gerants/garde-actuelle
  router.get('/terrains/:id/gerants/garde-actuelle', async (req, res) => {
    try {
      const garde = await gerantService.getGerantDeGarde(Number(req.params.id));
      res.json({ garde });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // GET /admin/gerants/search?q=
  router.get('/gerants/search', async (req, res) => {
    try {
      const rows = await gerantService.searchGerantsDisponibles(String(req.query.q || ''));
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // POST /admin/terrains/:id/gerants
  router.post('/terrains/:id/gerants', async (req, res) => {
    try {
      const { fait_par, role_fait_par } = actorMeta(req);
      const gerants = await gerantService.ajouterGerant(
        Number(req.params.id),
        req.body || {},
        fait_par,
        role_fait_par,
      );
      res.status(201).json({ gerants });
    } catch (err) {
      console.error(err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
    }
  });

  // PATCH /admin/terrains/:id/gerants/:gerant_id
  router.patch('/terrains/:id/gerants/:gerant_id', async (req, res) => {
    try {
      const { fait_par, role_fait_par } = actorMeta(req);
      const gerants = await gerantService.modifierGerant(
        Number(req.params.id),
        Number(req.params.gerant_id),
        req.body || {},
        fait_par,
        role_fait_par,
      );
      res.json({ gerants });
    } catch (err) {
      console.error(err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
    }
  });

  // DELETE /admin/terrains/:id/gerants/:gerant_id — soft delete
  router.delete('/terrains/:id/gerants/:gerant_id', async (req, res) => {
    try {
      const { fait_par, role_fait_par } = actorMeta(req);
      const gerants = await gerantService.retirerGerant(
        Number(req.params.id),
        Number(req.params.gerant_id),
        fait_par,
        role_fait_par,
      );
      res.json({ gerants });
    } catch (err) {
      console.error(err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
    }
  });

  // PUT /admin/terrains/:id/gerants/:gerant_id/planning
  router.put('/terrains/:id/gerants/:gerant_id/planning', async (req, res) => {
    try {
      const { fait_par, role_fait_par } = actorMeta(req);
      const planning = await gerantService.remplacerPlanning(
        Number(req.params.id),
        Number(req.params.gerant_id),
        {
          planning_hebdo: req.body?.planning_hebdo || [],
          dates_specifiques: req.body?.dates_specifiques || [],
        },
        fait_par,
        role_fait_par,
      );
      res.json({ planning });
    } catch (err) {
      console.error(err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
    }
  });

  // POST /admin/terrains/:id/gerants/:gerant_id/principal
  router.post('/terrains/:id/gerants/:gerant_id/principal', async (req, res) => {
    try {
      const { fait_par, role_fait_par } = actorMeta(req);
      const gerants = await gerantService.definirGerantPrincipal(
        Number(req.params.id),
        Number(req.params.gerant_id),
        fait_par,
        role_fait_par,
      );
      res.json({ gerants });
    } catch (err) {
      console.error(err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
    }
  });
}

function registerGerantMultiRoutes(app) {
  // GET /api/gerant/terrains
  app.get('/api/gerant/terrains', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const terrains = await gerantService.listTerrainsGerant(req.user.id);
      res.json({
        terrains,
        terrain_actif: req.user.terrain_id || null,
        terrains_ids: req.user.terrains_ids || [],
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // GET /api/gerant/planning
  app.get('/api/gerant/planning', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const planning = await gerantService.listPlanningGerantConnecte(req.user.id);
      const terrainId = resolveTerrainGerant(req);
      const collegues = terrainId
        ? await gerantService.getGerantsTerrain(terrainId)
        : [];
      const garde = terrainId ? await gerantService.getGerantDeGarde(terrainId) : null;
      res.json({
        planning,
        collegues,
        garde_actuelle: garde,
        multi_gerants: collegues.length > 1,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // GET /api/gerant/terrain/:terrain_id/gerants-en-ligne
  app.get(
    '/api/gerant/terrain/:terrain_id/gerants-en-ligne',
    authMiddleware,
    requireRole('gerant'),
    async (req, res) => {
      try {
        const terrainId = resolveTerrainGerant(req, req.params.terrain_id);
        if (!terrainId) {
          return res.status(403).json({ error: "Tu n'as pas accès à ce terrain." });
        }
        const autres = await gerantService.gerantsEnLigne(terrainId, req.user.id);
        res.json({ gerants: autres });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur serveur' });
      }
    },
  );

  // POST /api/gerant/heartbeat
  app.post('/api/gerant/heartbeat', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const terrainId = resolveTerrainGerant(req, req.body?.terrain_id);
      if (!terrainId) {
        return res.status(403).json({ error: "Tu n'as pas accès à ce terrain." });
      }
      await gerantService.heartbeat(req.user.id, terrainId);
      const autres = await gerantService.gerantsEnLigne(terrainId, req.user.id);
      res.json({ ok: true, autres_gerants: autres });
    } catch (err) {
      console.error(err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
    }
  });
}

module.exports = {
  registerAdminGerantsRoutes,
  registerGerantMultiRoutes,
};
