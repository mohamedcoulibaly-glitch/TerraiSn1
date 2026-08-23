const bcrypt = require('bcryptjs');
const { getDb, queryAll, queryOne } = require('../database');

function normalizePhoneDigits(identifier) {
  let phoneDigits = String(identifier || '').replace(/\D/g, '');
  if (phoneDigits.startsWith('00')) phoneDigits = phoneDigits.slice(2);
  if (phoneDigits.length === 9 && phoneDigits.startsWith('7')) phoneDigits = `221${phoneDigits}`;
  return phoneDigits;
}

(async () => {
  const db = await getDb();
  const candidates = ['750147138', '75 014 71 38', '+221750147138', '+221 75 014 71 38'];
  for (const id of candidates) {
    const phoneDigits = normalizePhoneDigits(id);
    console.log('\ntry', id, '→', phoneDigits);
    const rows = [
      ...(await queryAll(db, 'SELECT id, email, telephone, "proprietaire" AS t FROM proprietaires')),
      ...(await queryAll(db, 'SELECT id, email, telephone, "employe" AS t FROM employes')),
      ...(await queryAll(db, 'SELECT id, email, telephone, "user" AS t FROM users')),
    ];
    const hits = rows.filter((row) => {
      let rowDigits = String(row.telephone || '').replace(/\D/g, '');
      if (rowDigits.startsWith('00')) rowDigits = rowDigits.slice(2);
      if (rowDigits.length === 9 && rowDigits.startsWith('7')) rowDigits = `221${rowDigits}`;
      return rowDigits === phoneDigits;
    });
    console.log('hits', hits.map((h) => ({ t: h.t, id: h.id, email: h.email, tel: h.telephone })));
  }

  const babacar = await queryOne(db, 'SELECT * FROM employes WHERE email = ?', ['babacar.sene@gmail.com']);
  console.log('\nbabacar tel digits', String(babacar.telephone).replace(/\D/g, ''));
  console.log('pwd', bcrypt.compareSync('password123', babacar.password_hash));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
