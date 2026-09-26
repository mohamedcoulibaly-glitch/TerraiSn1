const crypto = require('crypto');
const multer = require('multer');
const { getDb, queryAll, queryOne, runSql, transaction, saveDb } = require('./database');
const { authMiddleware, requireRole } = require('./middleware/auth');
const {
  listTerrainPhotos,
  createTerrainPhoto,
  updateTerrainPhoto,
  deleteTerrainPhoto,
} = require('./terrainPhotoService');
const commoditesService = require('./services/commoditesService');
const { jourDepuisDate } = require('./scheduleService');
const { normalizeHourString } = require('./reservationLockService');

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Format image non supporté'));
  },
});

function requireTerrain(req, res) {
  const terrainId = Number(req.user?.terrain_id);
  if (!Number.isFinite(terrainId) || terrainId < 1) {
    res.status(400).json({ error: 'Gérant sans terrain actif' });
    return null;
  }
  return terrainId;
}

function bufferToDataUrl(buffer, mimetype) {
  const mime = String(mimetype || 'image/jpeg');
  return `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
}

function eachDateInclusive(debut, fin) {
  const out = [];
  const start = new Date(`${String(debut).slice(0, 10)}T12:00:00`);
  const end = new Date(`${String(fin).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return out;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function markCreneauxBloques(db, terrainId, date, heureDebut, heureFin) {
  runSql(
    db,
    `UPDATE creneaux SET statut = 'bloque'
      WHERE terrain_id = ? AND date = ? AND heure_debut >= ? AND heure_debut < ?
        AND statut IN ('libre', 'bloque')`,
    [terrainId, date, heureDebut, heureFin],
  );
}

function insertBlocageSlot(db, {
  terrainId,
  employeId,
  date,
  heureDebut,
  heureFin,
  type,
  libelle,
  groupeId,
  montant,
  motif,
  dateDebut,
  dateFin,
  jours,
}) {
  const exists = queryOne(
    db,
    `SELECT id FROM blocages_creneaux
      WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?`,
    [terrainId, date, heureDebut, heureFin],
  );
  if (exists) return { skipped: true };
  const result = runSql(
    db,
    `INSERT INTO blocages_creneaux
      (terrain_id, employe_id, date, heure_debut, heure_fin, motif, type_blocage, montant, libelle, groupe_id, date_debut, date_fin, jours, inclure_dans_ca)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      terrainId,
      employeId,
      date,
      heureDebut,
      heureFin,
      motif || type,
      type,
      montant != null ? Number(montant) : null,
      libelle || null,
      groupeId,
      dateDebut || null,
      dateFin || null,
      Array.isArray(jours) ? jours.join(',') : String(jours || ''),
    ],
  );
  markCreneauxBloques(db, terrainId, date, heureDebut, heureFin);
  return { id: result.lastInsertRowid, skipped: false };
}

function enrichGroupe(db, groupe) {
  const creneaux = queryAll(
    db,
    'SELECT id FROM blocages_creneaux WHERE groupe_id = ?',
    [groupe.id],
  );
  const encaissements = queryAll(
    db,
    `SELECT id, montant, date_encaissement, note, created_at
     FROM encaissements_blocages WHERE groupe_id = ? ORDER BY date_encaissement DESC, id DESC`,
    [groupe.id],
  );
  const montantContrat = Number(groupe.montant || 0);
  const montantEncaisse = encaissements.reduce((s, e) => s + Number(e.montant || 0), 0);
  return {
    ...groupe,
    type_blocage: groupe.type_blocage,
    montant_contrat: montantContrat,
    montant_encaisse: montantEncaisse,
    reste_a_encaisser: Math.max(0, montantContrat - montantEncaisse),
    nb_encaissements: encaissements.length,
    nb_creneaux: creneaux.length,
    encaissements,
  };
}

function mountGerantExtrasRoutes(app) {
  app.get('/api/gerant/terrain/photos', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const terrainId = requireTerrain(req, res);
      if (!terrainId) return;
      const db = await getDb();
      res.json(listTerrainPhotos(db, terrainId));
    } catch (err) {
      res.status(500).json({ error: err.message || 'Erreur serveur' });
    }
  });

  app.post(
    '/api/gerant/terrain/photos',
    authMiddleware,
    requireRole('gerant'),
    (req, res, next) => {
      if (String(req.headers['content-type'] || '').includes('multipart/form-data')) {
        return photoUpload.array('photos', 5)(req, res, next);
      }
      next();
    },
    async (req, res) => {
      try {
        const terrainId = requireTerrain(req, res);
        if (!terrainId) return;
        const db = await getDb();
        const files = req.files && req.files.length ? req.files : req.file ? [req.file] : [];
        const estPrincipale = req.body?.est_principale === 'true' || req.body?.est_principale === true;
        const created = [];
        transaction(db, () => {
          if (files.length) {
            files.forEach((file, idx) => {
              const dataUrl = bufferToDataUrl(file.buffer, file.mimetype);
              created.push(
                createTerrainPhoto(db, terrainId, {
                  dataUrl,
                  est_principale: estPrincipale || (idx === 0 && listTerrainPhotos(db, terrainId).length === 0),
                }),
              );
            });
          } else if (req.body?.dataUrl) {
            created.push(
              createTerrainPhoto(db, terrainId, {
                dataUrl: req.body.dataUrl,
                est_principale: estPrincipale,
              }),
            );
          }
        });
        if (!created.length) return res.status(400).json({ error: 'Aucune photo fournie' });
        saveDb();
        res.status(201).json(created.length === 1 ? created[0] : created);
      } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message || 'Upload impossible' });
      }
    },
  );

  app.delete('/api/gerant/terrain/photos/:id', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const terrainId = requireTerrain(req, res);
      if (!terrainId) return;
      const db = await getDb();
      const result = transaction(db, () => deleteTerrainPhoto(db, terrainId, Number(req.params.id)));
      saveDb();
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message || 'Suppression impossible' });
    }
  });

  app.patch('/api/gerant/terrain/photos/:id/principale', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const terrainId = requireTerrain(req, res);
      if (!terrainId) return;
      const db = await getDb();
      const photo = transaction(db, () =>
        updateTerrainPhoto(db, terrainId, Number(req.params.id), { est_principale: true }),
      );
      saveDb();
      res.json(photo);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message || 'Mise à jour impossible' });
    }
  });

  app.get('/api/gerant/terrain/commodites', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const terrainId = requireTerrain(req, res);
      if (!terrainId) return;
      const db = await getDb();
      res.json(commoditesService.listTerrainCommodites(db, terrainId));
    } catch (err) {
      res.status(500).json({ error: err.message || 'Erreur serveur' });
    }
  });

  app.patch('/api/gerant/terrain/commodites', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const terrainId = requireTerrain(req, res);
      if (!terrainId) return;
      const db = await getDb();
      const ids = Array.isArray(req.body?.commodite_ids) ? req.body.commodite_ids : [];
      const rows = transaction(db, () =>
        commoditesService.setGerantCommodites(db, terrainId, ids, commoditesService.actorFromReq(req)),
      );
      saveDb();
      res.json(rows);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message || 'Enregistrement impossible' });
    }
  });

  app.post('/api/gerant/blocages/abonnement', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const terrainId = requireTerrain(req, res);
      if (!terrainId) return;
      const db = await getDb();
      const body = req.body || {};
      const dateDebut = String(body.date_debut || '').slice(0, 10);
      const dateFin = String(body.date_fin || '').slice(0, 10);
      const heureDebut = normalizeHourString(body.heure_debut || '08:00');
      const heureFin = normalizeHourString(body.heure_fin || '12:00');
      const jours = Array.isArray(body.jours) ? body.jours.map((j) => String(j).toLowerCase()) : [];
      const libelle = String(body.libelle || '').trim();
      if (!dateDebut || !dateFin || !libelle || !jours.length) {
        return res.status(400).json({ error: 'libelle, dates et jours requis' });
      }
      const groupeId = `abo_${crypto.randomBytes(8).toString('hex')}`;
      const montant = Number(body.montant_mensuel_abonnement || body.montant || 0) || 0;
      let count = 0;
      let skipped = 0;
      transaction(db, () => {
        runSql(
          db,
          `INSERT INTO blocages_groupes
            (id, terrain_id, employe_id, type_blocage, libelle, date_debut, date_fin, jours, heure_debut, heure_fin, montant, motif, inclure_dans_ca)
           VALUES (?, ?, ?, 'ABONNEMENT', ?, ?, ?, ?, ?, ?, ?, 'abonnement', 1)`,
          [
            groupeId,
            terrainId,
            req.user.id,
            libelle,
            dateDebut,
            dateFin,
            jours.join(','),
            heureDebut,
            heureFin,
            montant,
          ],
        );
        for (const date of eachDateInclusive(dateDebut, dateFin)) {
          if (!jours.includes(jourDepuisDate(date))) continue;
          const result = insertBlocageSlot(db, {
            terrainId,
            employeId: req.user.id,
            date,
            heureDebut,
            heureFin,
            type: 'ABONNEMENT',
            libelle,
            groupeId,
            montant,
            motif: 'abonnement',
            dateDebut,
            dateFin,
            jours,
          });
          if (result.skipped) skipped += 1;
          else count += 1;
        }
      });
      saveDb();
      res.status(201).json({
        groupe_id: groupeId,
        count,
        skipped,
        message: `${count} créneau(x) bloqué(s) pour l'abonnement`,
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message || 'Blocage abonnement impossible' });
    }
  });

  app.post('/api/gerant/blocages/tournoi', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const terrainId = requireTerrain(req, res);
      if (!terrainId) return;
      const db = await getDb();
      const body = req.body || {};
      const dateDebut = String(body.date_debut || '').slice(0, 10);
      const dateFin = String(body.date_fin || '').slice(0, 10);
      const heureDebut = normalizeHourString(body.heure_debut || '08:00');
      const heureFin = normalizeHourString(body.heure_fin || '22:00');
      const jours = Array.isArray(body.jours) ? body.jours.map((j) => String(j).toLowerCase()) : [];
      const libelle = String(body.libelle || '').trim();
      if (!dateDebut || !dateFin || !libelle) {
        return res.status(400).json({ error: 'libelle et dates requis' });
      }
      const groupeId = `trn_${crypto.randomBytes(8).toString('hex')}`;
      const montant = Number(body.montant_tournoi || body.montant || 0) || 0;
      let count = 0;
      let skipped = 0;
      const joursFilter = jours.length ? jours : null;
      transaction(db, () => {
        runSql(
          db,
          `INSERT INTO blocages_groupes
            (id, terrain_id, employe_id, type_blocage, libelle, date_debut, date_fin, jours, heure_debut, heure_fin, montant, motif, inclure_dans_ca)
           VALUES (?, ?, ?, 'TOURNOI', ?, ?, ?, ?, ?, ?, ?, 'tournoi', 1)`,
          [
            groupeId,
            terrainId,
            req.user.id,
            libelle,
            dateDebut,
            dateFin,
            (joursFilter || []).join(','),
            heureDebut,
            heureFin,
            montant,
          ],
        );
        for (const date of eachDateInclusive(dateDebut, dateFin)) {
          if (joursFilter && !joursFilter.includes(jourDepuisDate(date))) continue;
          const creneaux = Array.isArray(body.creneaux) && body.creneaux.length
            ? body.creneaux
            : [{ heure_debut: heureDebut, heure_fin: heureFin }];
          for (const slot of creneaux) {
            const hd = normalizeHourString(slot.heure_debut || heureDebut);
            const hf = normalizeHourString(slot.heure_fin || heureFin);
            const result = insertBlocageSlot(db, {
              terrainId,
              employeId: req.user.id,
              date,
              heureDebut: hd,
              heureFin: hf,
              type: 'TOURNOI',
              libelle,
              groupeId,
              montant,
              motif: 'tournoi',
              dateDebut,
              dateFin,
              jours: joursFilter || [],
            });
            if (result.skipped) skipped += 1;
            else count += 1;
          }
        }
      });
      saveDb();
      res.status(201).json({
        groupe_id: groupeId,
        count,
        skipped,
        message: `${count} créneau(x) bloqué(s) pour le tournoi`,
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message || 'Blocage tournoi impossible' });
    }
  });

  app.get('/api/gerant/blocages/groupes', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const terrainId = requireTerrain(req, res);
      if (!terrainId) return;
      const db = await getDb();
      const type = req.query.type ? String(req.query.type).toUpperCase() : null;
      const params = [terrainId];
      let sql = 'SELECT * FROM blocages_groupes WHERE terrain_id = ?';
      if (type) {
        sql += ' AND type_blocage = ?';
        params.push(type);
      }
      sql += ' ORDER BY date_debut DESC, created_at DESC';
      const groupes = queryAll(db, sql, params).map((g) => enrichGroupe(db, g));
      res.json({ groupes });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Erreur serveur' });
    }
  });

  app.get('/api/gerant/blocages/groupes/:id', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const terrainId = requireTerrain(req, res);
      if (!terrainId) return;
      const db = await getDb();
      const groupe = queryOne(db, 'SELECT * FROM blocages_groupes WHERE id = ? AND terrain_id = ?', [
        String(req.params.id),
        terrainId,
      ]);
      if (!groupe) return res.status(404).json({ error: 'Groupe introuvable' });
      res.json(enrichGroupe(db, groupe));
    } catch (err) {
      res.status(500).json({ error: err.message || 'Erreur serveur' });
    }
  });

  app.post('/api/gerant/blocages/groupes/:id/encaisser', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const terrainId = requireTerrain(req, res);
      if (!terrainId) return;
      const db = await getDb();
      const groupe = queryOne(db, 'SELECT * FROM blocages_groupes WHERE id = ? AND terrain_id = ?', [
        String(req.params.id),
        terrainId,
      ]);
      if (!groupe) return res.status(404).json({ error: 'Groupe introuvable' });
      const montant = Number(req.body?.montant);
      if (!Number.isFinite(montant) || montant <= 0) {
        return res.status(400).json({ error: 'Montant invalide' });
      }
      const dateEnc = String(req.body?.date_encaissement || new Date().toISOString().slice(0, 10)).slice(0, 10);
      const note = String(req.body?.note || '').slice(0, 500);
      const result = transaction(db, () => {
        const insert = runSql(
          db,
          `INSERT INTO encaissements_blocages (groupe_id, terrain_id, employe_id, montant, date_encaissement, note)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [groupe.id, terrainId, req.user.id, montant, dateEnc, note || null],
        );
        return queryOne(db, 'SELECT * FROM encaissements_blocages WHERE id = ?', [insert.lastInsertRowid]);
      });
      saveDb();
      res.status(201).json({ encaissement: result, groupe: enrichGroupe(db, groupe) });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message || 'Encaissement impossible' });
    }
  });

  app.delete('/api/gerant/blocages/groupes/:id', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const terrainId = requireTerrain(req, res);
      if (!terrainId) return;
      const db = await getDb();
      const groupe = queryOne(db, 'SELECT * FROM blocages_groupes WHERE id = ? AND terrain_id = ?', [
        String(req.params.id),
        terrainId,
      ]);
      if (!groupe) return res.status(404).json({ error: 'Groupe introuvable' });
      transaction(db, () => {
        const slots = queryAll(db, 'SELECT * FROM blocages_creneaux WHERE groupe_id = ?', [groupe.id]);
        for (const slot of slots) {
          runSql(db, 'DELETE FROM blocages_creneaux WHERE id = ?', [slot.id]);
          runSql(
            db,
            `UPDATE creneaux SET statut = 'libre'
              WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ? AND statut = 'bloque'`,
            [terrainId, slot.date, slot.heure_debut, slot.heure_fin],
          );
        }
        runSql(db, 'DELETE FROM encaissements_blocages WHERE groupe_id = ?', [groupe.id]);
        runSql(db, 'DELETE FROM blocages_groupes WHERE id = ?', [groupe.id]);
      });
      saveDb();
      res.json({ deleted: true });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message || 'Suppression impossible' });
    }
  });
}

module.exports = { mountGerantExtrasRoutes };
