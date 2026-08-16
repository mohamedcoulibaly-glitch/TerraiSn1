const { getDb, runSql, saveDb } = require('./database');
const bcrypt = require('bcryptjs');

async function seed() {
  console.log('🌱 Démarrage du seeding...');
  const db = await getDb();

  // Vider les tables dans l'ordre (FK)
  const tables = ['audit_logs', 'notifications', 'avis', 'matchs', 'paiements', 'reservations', 'creneaux', 'blocages_creneaux', 'horaires', 'employes', 'terrains', 'proprietaires', 'users'];
  for (const t of tables) {
    db.run(`DELETE FROM ${t}`);
  }

  const hash = bcrypt.hashSync('password123', 10);

  // --- USERS (joueurs + superadmin) ---
  db.run('INSERT INTO users (nom, email, password_hash, telephone, role, is_active) VALUES (?, ?, ?, ?, ?, 1)', ['Abdou Sow', 'abdou@email.com', hash, '+221 77 123 45 67', 'joueur']);
  db.run('INSERT INTO users (nom, email, password_hash, telephone, role, is_active) VALUES (?, ?, ?, ?, ?, 1)', ['Fatou Diallo', 'fatou@email.com', hash, '+221 77 234 56 78', 'joueur']);
  db.run('INSERT INTO users (nom, email, password_hash, telephone, role, is_active) VALUES (?, ?, ?, ?, ?, 1)', ['Moussa Ba', 'moussa@email.com', hash, '+221 77 345 67 89', 'joueur']);
  db.run('INSERT INTO users (nom, email, password_hash, telephone, role, is_active) VALUES (?, ?, ?, ?, ?, 1)', ['Awa Ndiaye', 'awa@email.com', hash, '+221 77 456 78 90', 'joueur']);
  db.run('INSERT INTO users (nom, email, password_hash, telephone, role, is_active) VALUES (?, ?, ?, ?, ?, 1)', ['Ibrahima Fall', 'ibrahima@email.com', hash, '+221 77 567 89 01', 'joueur']);
  db.run('INSERT INTO users (nom, email, password_hash, telephone, role, is_active) VALUES (?, ?, ?, ?, ?, 1)', ['Cheikh Mbaye', 'cheikh@email.com', hash, '+221 77 678 90 12', 'joueur']);
  db.run('INSERT INTO users (nom, email, password_hash, telephone, role, is_active) VALUES (?, ?, ?, ?, ?, 1)', ['Super Admin', 'admin@terrainsn.sn', hash, '+221 70 000 00 00', 'superadmin']);

  // --- PROPRIETAIRES ---
  db.run("INSERT INTO proprietaires (nom, email, password_hash, telephone, plan, statut) VALUES (?, ?, ?, ?, ?, 'actif')", ['M. Diop', 'diop@terrainsn.sn', hash, '+221 78 100 00 01', 'premium']);
  db.run("INSERT INTO proprietaires (nom, email, password_hash, telephone, plan, statut) VALUES (?, ?, ?, ?, ?, 'actif')", ['Mme Fall', 'fall@terrainsn.sn', hash, '+221 78 200 00 02', 'free']);
  db.run("INSERT INTO proprietaires (nom, email, password_hash, telephone, plan, statut) VALUES (?, ?, ?, ?, ?, 'actif')", ['M. Ndiaye', 'ndiaye@terrainsn.sn', hash, '+221 78 300 00 03', 'free']);

  // --- TERRAINS ---
  const terrainsData = [
    // proprietaire_id, nom, adresse, ville, sport, type, prix_heure, description, telephone, photos, is_active, commodites
    [1, 'Complexe Sportif Pikine', 'Rue 10, Pikine', 'Dakar', 'foot', '11v11', 5000, 'Terrain en gazon synthétique de dernière génération.', '+221 77 123 45 67', '[]', 1, JSON.stringify(['dossards', 'eau', 'vestiaires', 'parking', 'buvette'])],
    [1, 'Terrain Almadies', 'Les Almadies', 'Dakar', 'foot', '7v7', 7500, 'Petit terrain idéal pour les matchs 7v7.', '+221 77 234 56 78', '[]', 1, JSON.stringify(['dossards', 'ballon', 'eau', 'vestiaires'])],
    [2, 'Stade Municipal Saly', 'Saly Portudal', 'Thiès', 'foot', '11v11', 6000, 'Grand terrain avec vestiaires et parking.', '+221 77 345 67 89', '[]', 1, JSON.stringify(['vestiaires', 'toilettes', 'parking', 'tribune'])],
    [1, 'Foot Indoor Ouakam', 'Ouakam', 'Dakar', 'foot', '5v5', 4000, 'Terrain indoor couvert.', '+221 77 456 78 90', '[]', 0, JSON.stringify(['dossards', 'eau', 'vestiaires'])],
    [2, 'Stade Demba Diop', 'Plateau', 'Dakar', 'foot', '11v11', 8000, 'Terrain homologué avec tribunes.', '+221 77 567 89 01', '[]', 1, JSON.stringify(['vestiaires', 'toilettes', 'tribune', 'parking', 'buvette', 'secours'])],
    [3, 'Terrain Guédiawaye', 'Guédiawaye', 'Dakar', 'foot', '7v7', 3500, 'Terrain de quartier bien entretenu.', '+221 77 678 90 12', '[]', 1, JSON.stringify(['eau', 'parking', 'priere'])],
    [1, 'Complexe Sportif Thiaroye', 'Thiaroye', 'Dakar', 'foot', '11v11', 4500, 'Deux terrains côte à côte avec buvette.', '+221 77 789 01 23', '[]', 1, JSON.stringify(['dossards', 'eau', 'vestiaires', 'buvette', 'glacons'])],
    [3, 'Terrain Saint-Louis Centre', 'Centre-ville', 'Saint-Louis', 'foot', '7v7', 3000, 'Terrain en plein cœur de Saint-Louis.', '+221 77 890 12 34', '[]', 1, JSON.stringify(['eau', 'vestiaires', 'parking'])],
    [1, 'Obélisque', 'Place de l\'Obélisque, Plateau', 'Dakar', 'foot', '5v5', 8000, 'Terrain très demandé près de l\'Obélisque — réservation anticipée conseillée.', '+221 77 900 11 22', '[]', 1, JSON.stringify(['dossards', 'eau', 'vestiaires', 'parking', 'toilettes', 'buvette'])],
  ];
  for (const t of terrainsData) {
    db.run(
      'INSERT INTO terrains (proprietaire_id, nom, adresse, ville, sport, type, prix_heure, description, telephone, photos, is_active, commodites) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      t
    );
  }

  // --- EMPLOYES ---
  const employesData = [
    [1, 1, 'Mamadou Sarr', 'sarr@terrainsn.sn', hash, '+221 77 111 22 33', '+221771112233', 1],
    [1, 2, 'Ousmane Diagne', 'diagne@terrainsn.sn', hash, '+221 77 222 33 44', '+221772223344', 1],
    [1, 4, 'Amadou Niang', 'niang@terrainsn.sn', hash, '+221 77 333 44 55', '+221773334455', 0],
    [2, 3, 'Aminata Sy', 'aminata@terrainsn.sn', hash, '+221 77 444 55 66', '+221774445566', 1],
    [3, 6, 'Pape Gueye', 'gueye@terrainsn.sn', hash, '+221 77 555 66 77', '+221775556677', 1],
    [1, 1, 'Mohamed Coulibaly', 'mohamed.gerant@gmail.com', hash, '+221 77 826 12 25', '+221778261225', 1],
  ];
  for (const e of employesData) {
    db.run('INSERT INTO employes (proprietaire_id, terrain_id, nom, email, password_hash, telephone, whatsapp_number, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', e);
  }

  // --- HORAIRES (pour chaque terrain, 7 jours) ---
  const jours = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  const terrainCount = terrainsData.length;
  for (let terrainId = 1; terrainId <= terrainCount; terrainId++) {
    for (const jour of jours) {
      const isWeekend = (jour === 'samedi' || jour === 'dimanche');
      const debut = isWeekend ? '09:00' : '08:00';
      const fin = jour === 'vendredi' || jour === 'samedi' ? '23:00' : jour === 'dimanche' ? '22:00' : '23:00';
      db.run('INSERT INTO horaires (terrain_id, jour, heure_debut, heure_fin, est_ouvert) VALUES (?, ?, ?, ?, 1)', [terrainId, jour, debut, fin]);
    }
  }

  // Créneaux soir démo (demain → +3 jours) pour tous les terrains
  function toLocalISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  for (let terrainId = 1; terrainId <= terrainCount; terrainId++) {
    for (let dayOffset = 1; dayOffset <= 3; dayOffset++) {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() + dayOffset);
      const dateStr = toLocalISO(d);
      for (const hour of [18, 19, 20, 21]) {
        const debut = `${String(hour).padStart(2, '0')}:00`;
        const fin = `${String(hour + 1).padStart(2, '0')}:00`;
        db.run(
          "INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, 'libre')",
          [terrainId, dateStr, debut, fin]
        );
      }
    }
  }

  // --- RESERVATIONS ---
  const reservationsData = [
    [1, 1, 'Abdou Sow', '2026-04-12', '16:00', '18:00', 10000, 'acceptee', '2026-04-12 16:15:00'],
    [2, 2, 'Fatou Diallo', '2026-04-13', '10:00', '12:00', 15000, 'en_attente', '2026-04-13 10:15:00'],
    [3, 3, 'Moussa Ba', '2026-04-11', '08:00', '10:00', 12000, 'refusee', null],
    [4, 4, 'Awa Ndiaye', '2026-04-10', '19:00', '21:00', 8000, 'acceptee', '2026-04-10 19:15:00'],
    [1, 5, 'Ibrahima Fall', '2026-04-14', '14:00', '16:00', 10000, 'en_attente', '2026-04-14 14:15:00'],
    [6, 6, 'Cheikh Mbaye', '2026-04-15', '17:00', '19:00', 7000, 'annulee', null],
  ];
  for (const r of reservationsData) {
    db.run('INSERT INTO reservations (terrain_id, joueur_id, joueur_nom, date, heure_debut, heure_fin, montant, statut, expire_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', r);
  }

  // --- PAIEMENTS ---
  db.run('INSERT INTO paiements (reservation_id, montant, methode, statut, reference_externe) VALUES (?, ?, ?, ?, ?)', [1, 10000, 'wave', 'paye', 'WAV-2026041201']);
  db.run('INSERT INTO paiements (reservation_id, montant, methode, statut, reference_externe) VALUES (?, ?, ?, ?, ?)', [4, 8000, 'orange_money', 'paye', 'OM-2026041001']);

  // --- AVIS ---
  const avisData = [
    [1, 1, 'Abdou Sow', 1, 5, 'Excellent terrain, bien entretenu !'],
    [4, 4, 'Awa Ndiaye', 4, 4, 'Bon terrain indoor, un peu petit mais correct.'],
    [null, 2, 'Fatou Diallo', 1, 5, 'Super ambiance et bon éclairage.'],
    [null, 3, 'Moussa Ba', 2, 4, 'Terrain correct, bien situé aux Almadies.'],
    [null, 5, 'Ibrahima Fall', 3, 5, 'Vestiaires propres, terrain de qualité.'],
    [null, 6, 'Cheikh Mbaye', 6, 4, 'Bonne ambiance de quartier.'],
    [null, 1, 'Abdou Sow', 9, 5, 'Obélisque au top — dossards et eau inclus !'],
    [null, 2, 'Fatou Diallo', 9, 4, 'Pratique, parking sécurisé.'],
    [null, 3, 'Moussa Ba', 9, 5, 'On réserve toujours la veille ici.'],
  ];
  for (const a of avisData) {
    db.run('INSERT INTO avis (reservation_id, joueur_id, joueur_nom, terrain_id, note, commentaire) VALUES (?, ?, ?, ?, ?, ?)', a);
  }

  // --- BLOCAGES CRENEAUX ---
  db.run('INSERT INTO blocages_creneaux (terrain_id, employe_id, date, heure_debut, heure_fin, motif) VALUES (?, ?, ?, ?, ?, ?)', [1, 1, '2026-04-12', '14:00', '16:00', 'Entretien pelouse']);
  db.run('INSERT INTO blocages_creneaux (terrain_id, employe_id, date, heure_debut, heure_fin, motif) VALUES (?, ?, ?, ?, ?, ?)', [1, 1, '2026-04-13', '10:00', '12:00', 'Événement privé']);

  // --- NOTIFICATIONS ---
  db.run("INSERT INTO notifications (destinataire_type, destinataire_id, type, canal, contenu, lu) VALUES (?, ?, ?, 'whatsapp', ?, ?)", ['user', 1, 'confirmation', 'Votre réservation au Complexe Sportif Pikine le 12 Avr a été confirmée.', 1]);
  db.run("INSERT INTO notifications (destinataire_type, destinataire_id, type, canal, contenu, lu) VALUES (?, ?, ?, 'whatsapp', ?, ?)", ['user', 2, 'rappel', 'Rappel : vous avez une réservation demain au Terrain Almadies à 10:00.', 0]);
  db.run("INSERT INTO notifications (destinataire_type, destinataire_id, type, canal, contenu, lu) VALUES (?, ?, ?, 'whatsapp', ?, ?)", ['user', 5, 'confirmation', 'Votre réservation est en attente de validation.', 0]);

  saveDb();
  console.log('✅ Seeding terminé avec succès !');
}

seed().catch(console.error);
