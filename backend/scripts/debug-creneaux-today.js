const API = 'http://localhost:3001/api';

async function main() {
  const login = await fetch(`${API}/backoffice/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'babacar.sene@gmail.com', password: 'password123' }),
  }).then((r) => r.json());
  const token = login.accessToken || login.token;
  const tid = login.user.terrain_id;
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  console.log('today', date, 'jour', jours[d.getDay()]);

  const order = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  const horaires = order.map((jour) => ({
    jour,
    est_ouvert: 1,
    heure_debut: '08:00',
    heure_fin: '23:00',
  }));
  const put = await fetch(`${API}/gerant/horaires`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ horaires }),
  }).then((r) => r.json());
  console.log('put', put.message || put.error);

  const cr = await fetch(`${API}/terrains/${tid}/creneaux?date=${date}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  console.log('message', cr.message);
  console.log('count', (cr.creneaux || []).length, 'libres', (cr.creneaux || []).filter((c) => c.disponible).length);
  console.log('sample', (cr.creneaux || []).slice(0, 3));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
