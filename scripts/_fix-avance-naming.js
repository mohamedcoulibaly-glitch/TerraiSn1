const fs = require('fs');

function fixAdmin() {
  const f = 'backend/routes/admin.js';
  let c = fs.readFileSync(f, 'utf8');
  c = c.replace(/politique_paiement \|\| 'avec_avance'/g, "politique_paiement || 'avance'");
  c = c.replace(/if \(politique === 'avance'\) politique = 'avec_avance';/g, "if (politique === 'avec_avance') politique = 'avance';");
  c = c.replace(/\['avec_avance', 'sans_avance'\]/g, "['avance', 'sans_avance']");
  c = c.replace(/doit être 'avec_avance' ou 'sans_avance'/g, "doit être 'avance' ou 'sans_avance'");
  c = c.replace(/\('avec_avance' \| 'sans_avance'\)/g, "('avance' | 'sans_avance')");
  fs.writeFileSync(f, c);
}

function fixIndex() {
  const f = 'backend/index.js';
  let c = fs.readFileSync(f, 'utf8');
  c = c.replace(/politique_paiement \|\| 'avec_avance'/g, "politique_paiement || 'avance'");
  fs.writeFileSync(f, c);
}

function fixTab() {
  const f = 'frontend/src/espaces/backoffice/components/superadmin/ContratPaiementTab.tsx';
  let c = fs.readFileSync(f, 'utf8');
  c = c.replace(/avec_avance/g, 'avance');
  c = c.replace(/delai_paiement_dette_jours \?\? 7/g, 'delai_paiement_dette_jours ?? 30');
  c = c.replace(/Number\(delaiDette\) \|\| 7/g, 'Number(delaiDette) || 30');
  c = c.replace(/delai_paiement_dette_jours \|\| 7/g, 'delai_paiement_dette_jours || 30');
  fs.writeFileSync(f, c);
}

function fixApi() {
  const f = 'frontend/src/services/superAdminApi.ts';
  let c = fs.readFileSync(f, 'utf8');
  c = c.replace(/avec_avance/g, 'avance');
  fs.writeFileSync(f, c);
}

fixAdmin();
fixIndex();
fixTab();
fixApi();
console.log('normalized avance');
