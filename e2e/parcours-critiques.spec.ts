import { test, expect, type Page, type Route } from "@playwright/test";

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

async function stubPublicApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    const path = url.replace(/^https?:\/\/[^/]+/i, "");

    // Refresh silencieux sans cookie → 401 (évite une fausse session E2E)
    if (path.includes("/auth/refresh") && method === "POST") {
      return mockJson(route, { error: "TOKEN_EXPIRE" }, 401);
    }

    if (path.includes("/auth/me") && method === "GET") {
      if (!hasBearer(route)) return mockJson(route, { error: "Non authentifié" }, 401);
      return mockJson(route, {
        id: 1,
        role: "joueur",
        accountType: "user",
        nom: "Test",
        prenom: "Joueur",
        email: "joueur@test.sn",
      });
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
      return mockJson(route, {
        accessToken: isBackoffice ? "e2e-gerant-token" : "e2e-access-token",
        token: isBackoffice ? "e2e-gerant-token" : "e2e-access-token",
        user: isBackoffice
          ? {
              id: 2,
              role: "gerant",
              accountType: "employe",
              nom: "Test",
              prenom: "Gerant",
              email: "gerant@test.sn",
              terrain_id: 1,
            }
          : {
              id: 1,
              role: "joueur",
              accountType: "user",
              nom: "Test",
              prenom: "Joueur",
              email: post.email || "joueur@test.sn",
              telephone: "221771234567",
            },
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
          {
            heure: "19:00",
            heure_debut: "19:00",
            heure_fin: "20:00",
            disponible: true,
            statut: "libre",
            label: "19:00",
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

    // Fiche terrain consolidée /api/terrains/:id/full-details
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

    // Fiche terrain /api/terrains/:id (pas la liste)
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

    return mockJson(route, { ok: true, mocked: true });
  });
}

test.describe("E2E — Parcours joueur (UI)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await stubPublicApi(page);
  });

  test("Accueil charge et affiche du contenu", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("#root")).not.toBeEmpty();
  });

  test("Explorer affiche un terrain mocké", async ({ page }) => {
    await page.goto("/explorer");
    await expect(page.getByText(/Arena Test Parcelles/i).first()).toBeVisible({ timeout: 20000 });
  });

  test("Fiche terrain accessible", async ({ page }) => {
    await page.goto("/terrain/1");
    await expect(page.getByText(/Arena Test Parcelles|Terrain non trouvé/i).first()).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText(/Arena Test Parcelles/i).first()).toBeVisible();
  });

  test("Login joueur — erreur identifiants", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("#login-id")).toBeVisible({ timeout: 20000 });
    await page.locator("#login-id").fill("fail@test.sn");
    await page.locator("#login-pass").fill("wrongpass");
    await page.locator('button[type="submit"]').first().click();
    await expect(page.getByText(/Mot de passe incorrect|Identifiants incorrects/i).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("Login joueur réussi quitte /login", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("#login-id")).toBeVisible({ timeout: 20000 });
    await page.locator("#login-id").fill("joueur@test.sn");
    await page.locator("#login-pass").fill("password123");
    await page.locator('button[type="submit"]').first().click();
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 15000 });
  });
});

test.describe("E2E — Parcours backoffice", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await stubPublicApi(page);
  });

  test("Page login backoffice accessible", async ({ page }) => {
    await page.goto("/backoffice/login");
    await expect(page.locator("#root")).not.toBeEmpty();
    await expect(page.locator('input[type="password"], form, input').first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("Route protégée gérant sans auth", async ({ page }) => {
    await page.goto("/backoffice/gerant");
    await expect(page).toHaveURL(/\/backoffice\/login/, { timeout: 15000 });
  });
});

test.describe("E2E — Navigation parcours critique", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await stubPublicApi(page);
  });

  test("Chaîne Accueil → Explorer → Fiche", async ({ page }) => {
    await page.goto("/");
    await page.goto("/explorer");
    await expect(page.getByText(/Arena Test Parcelles/i).first()).toBeVisible({ timeout: 20000 });
    await page.goto("/terrain/1");
    await expect(page.getByText(/Arena Test Parcelles/i).first()).toBeVisible({ timeout: 20000 });
  });

  test("404 pour route inconnue", async ({ page }) => {
    await page.goto("/cette-route-nexiste-pas-xyz");
    await expect(page.getByText(/404|not found|introuvable/i).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("Legacy /joueur est une 404 (pas d'espace dédié)", async ({ page }) => {
    await page.goto("/joueur");
    await expect(page.getByText(/404|not found|introuvable/i).first()).toBeVisible({
      timeout: 15000,
    });
  });
});
