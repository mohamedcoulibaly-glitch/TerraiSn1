import { test, expect, type Page, type Route } from "@playwright/test";

/** JWT factice (header.payload.sig) avec `exp` futur — base64 standard pour `atob` (parseJwt). */
function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({
    ...claims,
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  })}.e2e-sig`;
}

type StaffRole = "gerant" | "proprietaire" | "super_admin";
type AnyRole = "joueur" | StaffRole;

function userForRole(role: AnyRole) {
  if (role === "gerant") {
    return {
      id: 2,
      role: "gerant",
      accountType: "employe",
      nom: "Test",
      prenom: "Gerant",
      email: "gerant@test.sn",
      terrain_id: 1,
    };
  }
  if (role === "proprietaire") {
    return {
      id: 3,
      role: "proprietaire",
      accountType: "proprietaire",
      nom: "Test",
      prenom: "Proprio",
      email: "proprietaire@test.sn",
    };
  }
  if (role === "super_admin") {
    return {
      id: 4,
      role: "super_admin",
      accountType: "super_admin",
      nom: "Test",
      prenom: "Admin",
      email: "admin@test.sn",
    };
  }
  return {
    id: 1,
    role: "joueur",
    accountType: "user",
    nom: "Test",
    prenom: "Joueur",
    email: "joueur@test.sn",
    telephone: "221771234567",
  };
}

function tokenForRole(role: AnyRole): string {
  const u = userForRole(role);
  return fakeJwt({ sub: u.id, role: u.role, accountType: u.accountType, email: u.email });
}

async function mockJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function hasBearer(route: Route): boolean {
  const auth = route.request().headers()["authorization"] || "";
  return /^Bearer\s+\S+/i.test(auth);
}

function bearerToken(route: Route): string {
  const auth = route.request().headers()["authorization"] || "";
  const m = auth.match(/^Bearer\s+(\S+)/i);
  return m?.[1] || "";
}

function roleFromToken(token: string): AnyRole {
  if (!token) return "joueur";
  try {
    const part = token.split(".")[1] || "";
    const payload = JSON.parse(Buffer.from(part, "base64").toString("utf8")) as {
      role?: string;
    };
    const r = String(payload.role || "").toLowerCase();
    if (r === "super_admin" || r === "superadmin") return "super_admin";
    if (r === "proprietaire") return "proprietaire";
    if (r === "gerant" || r === "employe") return "gerant";
    if (r === "joueur" || r === "user") return "joueur";
  } catch {
    /* ignore */
  }
  if (/super_admin|superadmin|"admin@/i.test(token)) return "super_admin";
  if (/proprietaire|proprio/i.test(token)) return "proprietaire";
  if (/gerant|employe/i.test(token)) return "gerant";
  return "joueur";
}

function roleFromLoginId(id: string): AnyRole {
  const s = id.toLowerCase();
  if (/super|admin/.test(s)) return "super_admin";
  if (/proprio/.test(s)) return "proprietaire";
  if (/gerant/.test(s)) return "gerant";
  return "joueur";
}

async function stubPublicApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    const path = url.replace(/^https?:\/\/[^/]+/i, "");

    if (path.includes("/auth/refresh") && method === "POST") {
      return mockJson(route, { error: "TOKEN_EXPIRE" }, 401);
    }

    if (path.includes("/auth/me") && method === "GET") {
      if (!hasBearer(route)) return mockJson(route, { error: "Non authentifié" }, 401);
      const role = roleFromToken(bearerToken(route));
      return mockJson(route, userForRole(role));
    }

    if (path.includes("/auth/logout") && method === "POST") {
      return mockJson(route, { ok: true });
    }

    if ((path.includes("/auth/login") || path.includes("/backoffice/auth/login")) && method === "POST") {
      const post = (route.request().postDataJSON() || {}) as {
        email?: string;
        telephone?: string;
        password?: string;
      };
      const id = String(post.email || post.telephone || "");
      if (id.includes("fail") || post.password === "wrongpass") {
        return mockJson(route, { error: "Identifiants incorrects." }, 401);
      }
      const isBackoffice = path.includes("/backoffice/");
      const role = isBackoffice ? roleFromLoginId(id) || "gerant" : "joueur";
      const staffRole: StaffRole =
        role === "joueur" ? "gerant" : (role as StaffRole);
      const finalRole: AnyRole = isBackoffice ? staffRole : "joueur";
      const user = userForRole(finalRole);
      if (post.email) user.email = post.email;
      const token = tokenForRole(finalRole);
      return mockJson(route, {
        accessToken: token,
        token,
        user,
      });
    }

    if (path.includes("/creneaux") && method === "GET") {
      return mockJson(route, {
        date: "2026-12-01",
        creneaux: [
          {
            heure: "18:00",
            heure_debut: "18:00",
            heure_fin: "19:00",
            disponible: true,
            statut: "libre",
            label: "18:00",
          },
        ],
      });
    }

    if (path.includes("/devis") && method === "GET") {
      return mockJson(route, {
        terrain_id: 1,
        date: "2026-12-01",
        heure_debut: "18:00",
        heure_fin: "19:00",
        montant: 40000,
        montant_avance: 5000,
        montant_restant: 35000,
        format_terrain: "entier",
      });
    }

    if (/\/terrains\/\d+\/full-details/.test(path) && method === "GET") {
      return mockJson(route, {
        id: 1,
        nom: "Arena Test Parcelles",
        ville: "Dakar",
        adresse: "Parcelles Assainies",
        sport: "foot",
        type: "5v5",
        prix_entier: 40000,
        prix_moitie: 24000,
        prix_heure: 40000,
        pourcentage_avance: 12.5,
        description: "Terrain synthétique",
        is_active: 1,
        note: 4.5,
        avis_count: 12,
        horaires: [{ jour: "lundi", heure_debut: "08:00", heure_fin: "00:00", est_ouvert: 1 }],
        commodites: [],
        photos: [],
        avis: [],
        formats: [
          { cle: "moitie", label: "Demi-terrain", prix_heure: 24000 },
          { cle: "entier", label: "Terrain entier", prix_heure: 40000 },
        ],
        durees: [
          { label: "1h", minutes: 60 },
          { label: "2h", minutes: 120 },
        ],
        features: {},
        en_ligne_indisponible: false,
        booking_online_available: true,
        planning: {
          date: "2026-12-01",
          terrain_id: 1,
          creneaux: [
            {
              heure: "18:00",
              heure_debut: "18:00",
              heure_fin: "19:00",
              disponible: true,
              statut: "libre",
              label: "18:00",
            },
          ],
          ferme: false,
        },
      });
    }

    if (/\/terrains\/\d+(\?|$)/.test(path) && method === "GET") {
      return mockJson(route, {
        id: 1,
        nom: "Arena Test Parcelles",
        ville: "Dakar",
        adresse: "Parcelles Assainies",
        sport: "foot",
        type: "5v5",
        prix_entier: 40000,
        prix_moitie: 24000,
        prix_heure: 40000,
        pourcentage_avance: 12.5,
        description: "Terrain synthétique",
        is_active: 1,
        note: 4.5,
        avis_count: 12,
        horaires: [{ jour: "lundi", heure_debut: "08:00", heure_fin: "00:00", est_ouvert: 1 }],
        commodites: [],
        photos: [],
        avis: [],
      });
    }

    if (path.includes("/terrains") && method === "GET") {
      return mockJson(route, [
        {
          id: 1,
          nom: "Arena Test Parcelles",
          ville: "Dakar",
          adresse: "Parcelles Assainies",
          sport: "foot",
          type: "5v5",
          prix_entier: 40000,
          prix_heure: 40000,
          prix_moitie: 24000,
          note_moyenne: 4.5,
          photo_url: null,
          latitude: 14.76,
          longitude: -17.4,
          is_active: 1,
        },
      ]);
    }

    // Listes backoffice fréquemment consommées comme tableaux
    if (method === "GET" && /\/gerant\/terrains(\?|$)/.test(path)) {
      return mockJson(route, {
        terrains: [{ id: 1, nom: "Arena Test", est_principal: 1 }],
        terrain_actif: 1,
      });
    }

    if (
      method === "GET" &&
      (/\/(gerants|proprietaires|superadmins|utilisateurs|joueurs|reservations|notifications|abonnements|commodites|audit)(\?|$)/.test(
        path
      ) ||
        /\/proprietaire\/terrains/.test(path) ||
        /\/admin\/terrains/.test(path))
    ) {
      return mockJson(route, []);
    }

    if (method === "GET" && /\/gerant\/dashboard/.test(path)) {
      return mockJson(route, {
        ok: true,
        terrain: { id: 1, nom: "Arena Test" },
        reservations: [],
        kpis: {},
      });
    }

    if (method === "GET" && (/\/dashboard/.test(path) || /\/stats/.test(path) || /\/kpis/.test(path))) {
      return mockJson(route, { ok: true, mocked: true, terrains: [], alertes: [], kpis: {} });
    }

    return mockJson(route, { ok: true, mocked: true });
  });
}

/** Injecte token + user avant le premier chargement (évite le redirect login). */
async function seedAuth(page: Page, role: AnyRole) {
  const user = userForRole(role);
  const token = tokenForRole(role);
  await page.addInitScript(
    ({ userJson, tokenValue }) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("access_token", tokenValue);
      localStorage.setItem("terrainsn_token", tokenValue);
      localStorage.setItem("terrainsn_user", userJson);
    },
    { userJson: JSON.stringify(user), tokenValue: token }
  );
}

async function clearStorage(page: Page) {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

async function expectNot404(page: Page) {
  await expect(page.getByRole("heading", { name: "404" })).toHaveCount(0);
  await expect(page.getByText(/Oops! Page not found/i)).toHaveCount(0);
  await expect(page).not.toHaveURL(/cette-route|not-found/i);
}

// ─── JOUEUR ───────────────────────────────────────────────────────────────────

test.describe("E2E — JOUEUR navigation", () => {
  // BottomNav = md:hidden → forcer mobile
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await stubPublicApi(page);
  });

  test("Landing / affiche du contenu", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("#root")).not.toBeEmpty();
    await expect(page.getByLabel("Navigation principale")).toBeVisible({ timeout: 15000 });
  });

  test("BottomNav — Accueil, Explorer, Réservations, Profil", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByLabel("Navigation principale");
    await expect(nav).toBeVisible({ timeout: 15000 });

    await nav.getByRole("button", { name: "Explorer" }).click();
    await expect(page).toHaveURL(/\/explorer/, { timeout: 10000 });
    await expectNot404(page);

    await nav.getByRole("button", { name: "Accueil" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10000 });
    await expectNot404(page);

    // Non connecté : Réservations → RequireJoueurAuth → /login
    await nav.getByRole("button", { name: "Réservations" }).click();
    await expect(page).toHaveURL(/\/(reservations|login)/, { timeout: 10000 });
    await expectNot404(page);

    await page.goto("/");
    await nav.getByRole("button", { name: "Profil" }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    await expectNot404(page);
  });

  test("/explorer accessible", async ({ page }) => {
    await page.goto("/explorer");
    await expect(page).toHaveURL(/\/explorer/);
    await expect(page.getByText(/Arena Test Parcelles/i).first()).toBeVisible({ timeout: 20000 });
    await expectNot404(page);
  });

  test("CTAs principaux ne mènent pas à une 404", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#root")).not.toBeEmpty();

    const paths = ["/", "/explorer", "/login", "/terrain/1"];
    for (const p of paths) {
      await page.goto(p);
      await expectNot404(page);
      await expect(page.locator("#root")).not.toBeEmpty();
    }

    // Liens internes visibles sur l’accueil / explorer
    await page.goto("/explorer");
    const terrainLink = page.getByRole("link", { name: /Arena Test Parcelles/i }).first();
    if (await terrainLink.count()) {
      await terrainLink.click();
      await expect(page).toHaveURL(/\/terrain\/\d+/, { timeout: 15000 });
      await expectNot404(page);
    }
  });

  test("Login — page OK et échec affiche erreur", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("#login-id")).toBeVisible({ timeout: 20000 });
    await page.locator("#login-id").fill("fail@test.sn");
    await page.locator("#login-pass").fill("wrongpass");
    await page.locator('button[type="submit"]').first().click();
    // messageErreurAuth mappe 401 → libellé UX (pas le texte brut API)
    await expect(
      page.getByText(/Mot de passe incorrect|Identifiants incorrects/i).first()
    ).toBeVisible({ timeout: 10000 });
  });
});

// ─── GÉRANT ───────────────────────────────────────────────────────────────────

test.describe("E2E — GERANT navigation", () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await stubPublicApi(page);
  });

  test("Login backoffice stub → /backoffice/gerant", async ({ page }) => {
    await page.goto("/backoffice/login");
    await expect(page.locator("#bo-id")).toBeVisible({ timeout: 20000 });
    await page.locator("#bo-id").fill("gerant@test.sn");
    await page.locator("#bo-pass").fill("password123");
    await page.locator('button[type="submit"]').first().click();
    await expect(page).toHaveURL(/\/backoffice\/gerant\/?$/, { timeout: 20000 });
    await expectNot404(page);
  });

  test("Onglets Accueil / Joueurs|Réservation / Finances / Paramètres", async ({ page }) => {
    await seedAuth(page, "gerant");
    await page.goto("/backoffice/gerant");
    await expect(page).toHaveURL(/\/backoffice\/gerant\/?$/, { timeout: 20000 });
    await expectNot404(page);
    // Chrome gérant : header mobile (Bonjour) ou lien Accueil visible (sidebar OU bottom nav)
    await expect(page.getByText(/Bonjour /i).first()).toBeVisible({ timeout: 20000 });

    const tabs: { href: string; url: RegExp }[] = [
      { href: "/backoffice/gerant", url: /\/backoffice\/gerant\/?$/ },
      { href: "/backoffice/gerant/joueurs", url: /\/backoffice\/gerant\/joueurs/ },
      { href: "/backoffice/gerant/finances", url: /\/backoffice\/gerant\/finances/ },
      { href: "/backoffice/gerant/parametres", url: /\/backoffice\/gerant\/parametres/ },
    ];

    for (const tab of tabs) {
      const link = page.locator(`a[href="${tab.href}"]`).locator("visible=true").first();
      await expect(link).toBeVisible({ timeout: 15000 });
      await link.click();
      await expect(page).toHaveURL(tab.url, { timeout: 15000 });
      await expectNot404(page);
    }
  });
});

// ─── PROPRIÉTAIRE ─────────────────────────────────────────────────────────────

test.describe("E2E — PROPRIETAIRE navigation", () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await stubPublicApi(page);
  });

  test("Dashboard + onglets Aperçu / Revenus / Santé / Terrains (URLs path)", async ({ page }) => {
    await seedAuth(page, "proprietaire");
    await page.goto("/backoffice/proprietaire");
    await expect(page).toHaveURL(/\/backoffice\/proprietaire\/?$/, { timeout: 20000 });
    await expectNot404(page);

    const tabs: { label: RegExp; url: RegExp }[] = [
      { label: /^Aperçu$/i, url: /\/backoffice\/proprietaire\/?$/ },
      { label: /^Revenus$/i, url: /\/backoffice\/proprietaire\/revenus/ },
      { label: /^Santé$/i, url: /\/backoffice\/proprietaire\/sante/ },
      { label: /^Terrains$/i, url: /\/backoffice\/proprietaire\/terrains/ },
    ];

    for (const tab of tabs) {
      // Sidebar desktop + bottom nav mobile : prendre le premier visible
      const link = page.getByRole("link", { name: tab.label }).first();
      await expect(link).toBeVisible({ timeout: 15000 });
      await link.click();
      await expect(page).toHaveURL(tab.url, { timeout: 15000 });
      // Régression : terrains = path dédié, pas seulement ?view=
      expect(page.url()).not.toMatch(/[?&]view=/);
      await expectNot404(page);
    }

    await page.goto("/backoffice/proprietaire/terrains");
    await expect(page).toHaveURL(/\/backoffice\/proprietaire\/terrains/);
    await expectNot404(page);
  });
});

// ─── SUPERADMIN ───────────────────────────────────────────────────────────────

test.describe("E2E — SUPERADMIN navigation", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await stubPublicApi(page);
  });

  test("Sidebar + Voir l'app href=/ + routes gerants/proprietaires", async ({ page }) => {
    await seedAuth(page, "super_admin");
    await page.goto("/backoffice/superadmin");
    await expect(page).toHaveURL(/\/backoffice\/superadmin\/?$/, { timeout: 20000 });
    await expectNot404(page);

    // TDB / Tableau de bord
    await page.getByRole("link", { name: /Tableau de bord/i }).first().click();
    await expect(page).toHaveURL(/\/backoffice\/superadmin\/?$/, { timeout: 10000 });

    await page.getByRole("link", { name: /^Terrains$/i }).first().click();
    await expect(page).toHaveURL(/\/backoffice\/superadmin\/terrains/, { timeout: 10000 });
    await expectNot404(page);

    // Groupe Utilisateurs → Gérants / Propriétaires
    const usersToggle = page.getByRole("button", { name: /Utilisateurs/i }).first();
    if (await usersToggle.isVisible()) {
      await usersToggle.click();
    }
    await page.getByRole("link", { name: /^Gérants$/i }).first().click();
    await expect(page).toHaveURL(/\/backoffice\/superadmin\/gerants/, { timeout: 10000 });
    await expectNot404(page);

    await page.getByRole("link", { name: /^Propriétaires$/i }).first().click();
    await expect(page).toHaveURL(/\/backoffice\/superadmin\/proprietaires/, { timeout: 10000 });
    await expectNot404(page);

    // Lien « Vue d'ensemble » utilisateurs si présent
    const overview = page.getByRole("link", { name: /Vue d'ensemble|Utilisateurs/i }).filter({
      hasNotText: /Gérants|Propriétaires|Superadmins/,
    });
    // Accès direct route utilisateurs
    await page.goto("/backoffice/superadmin/utilisateurs");
    await expect(page).toHaveURL(/\/backoffice\/superadmin\/utilisateurs/);
    await expectNot404(page);

    await page.goto("/backoffice/superadmin/caisse");
    await expect(page).toHaveURL(/\/backoffice\/superadmin\/caisse/);
    await expectNot404(page);

    // FIX critique : Voir l'app → "/" pas "/joueur"
    await page.goto("/backoffice/superadmin");
    const voirApp = page.locator('a[title="Voir l\'app"]');
    await expect(voirApp).toBeVisible({ timeout: 15000 });
    await expect(voirApp).toHaveAttribute("href", "/");
    const href = await voirApp.getAttribute("href");
    expect(href).not.toBe("/joueur");
    expect(href).not.toMatch(/\/joueur/);

    // Routes critiques sans 404 (API vide OK)
    for (const path of [
      "/backoffice/superadmin/gerants",
      "/backoffice/superadmin/proprietaires",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
      await expectNot404(page);
      await expect(page.locator("#root")).not.toBeEmpty();
    }
  });
});

// ─── Régressions navigation ───────────────────────────────────────────────────

test.describe("E2E — Régressions navigation", () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await stubPublicApi(page);
  });

  test("/joueur → 404 (route absente ; liens corrigés hors /joueur)", async ({ page }) => {
    // Attendu documenté : pas de route /joueur → NotFound (404).
    await page.goto("/joueur");
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Page not found|introuvable/i).first()).toBeVisible();
  });

  test("/profil/notifications accessible joueur authentifié", async ({ page }) => {
    await seedAuth(page, "joueur");
    await page.goto("/profil/notifications");
    await expect(page).toHaveURL(/\/profil\/notifications/, { timeout: 20000 });
    await expectNot404(page);
    await expect(page.getByRole("heading", { name: /Notifications/i }).first()).toBeVisible({
      timeout: 20000,
    });
  });
});
