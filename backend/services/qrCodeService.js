/**
 * QR code stylisé à la charte du terrain (header/footer couleur terrain).
 *
 * - Contenu encodé : le payload SIGNÉ existant (domain/qrSignature) — le scanner
 *   gérant rejette tout payload non signé, on ne change donc pas le format.
 * - Rendu : qrcode (modules) + sharp (composition SVG header/footer + QR).
 *   sharp est requis paresseusement : si indisponible, l'appelant retombe sur
 *   le QR brut (QRCode.toFile) — la confirmation ne doit jamais être bloquée.
 * - Dynamique : nom + couleur_primaire du terrain lus en DB à chaque génération.
 */
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { UPLOAD_ROOT } = require('../terrainPhotoService');

const COULEUR_DEFAUT = '#059669';

function normaliserCouleur(couleur) {
  const c = String(couleur || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : COULEUR_DEFAUT;
}

function hexToRgb(hex) {
  const h = normaliserCouleur(hex).slice(1);
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function assombrir({ r, g, b }, facteur = 0.78) {
  return {
    r: Math.round(r * facteur),
    g: Math.round(g * facteur),
    b: Math.round(b * facteur),
  };
}

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formaterDateCourt(dateStr) {
  if (!dateStr) return '';
  const JOURS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`;
}

/**
 * @param {object} params
 * @param {string} params.payload          Contenu encodé (payload signé)
 * @param {string} params.codeReservation  ex. TF-604916
 * @param {string} params.terrainNom
 * @param {string} [params.terrainCouleur] hex #RRGGBB (défaut vert TerrainSN)
 * @param {string} [params.date]           YYYY-MM-DD
 * @param {string} [params.heureDebut]     HH:MM
 * @param {string} [params.heureFin]       HH:MM
 * @param {string} [params.cheminSortie]   chemin absolu (défaut UPLOAD_ROOT/qr/<code>.png)
 * @returns {Promise<{url:string, cheminAbsolu:string, buffer:Buffer}>}
 */
async function genererQRCodeStylise({
  payload,
  codeReservation,
  terrainNom,
  terrainCouleur = COULEUR_DEFAUT,
  date,
  heureDebut,
  heureFin,
  cheminSortie = null,
}) {
  // eslint-disable-next-line global-require
  const sharp = require('sharp');

  const couleur = normaliserCouleur(terrainCouleur);
  const rgb = hexToRgb(couleur);
  const rgbFonce = assombrir(rgb);

  const tailleQr = 400;
  const qrBuffer = await QRCode.toBuffer(String(payload), {
    errorCorrectionLevel: 'H', // 30 % de redondance — scan robuste malgré la charte
    type: 'png',
    width: tailleQr,
    margin: 2,
    color: { dark: '#0D1B2A', light: '#FFFFFF' },
  });

  const largeur = 600;
  const hauteurHeader = 118;
  const hauteurQr = tailleQr + 36;
  const hauteurFooter = 96;
  const hauteurTotale = hauteurHeader + hauteurQr + hauteurFooter;

  const nomAffiche = escapeXml(String(terrainNom || 'Terrain').toUpperCase().slice(0, 26));
  const codeAffiche = escapeXml(codeReservation || '');
  const creneau = [formaterDateCourt(date), [heureDebut, heureFin].filter(Boolean).map((h) => String(h).slice(0, 5)).join(' – ')]
    .filter(Boolean)
    .join(' · ');

  const svg = `
<svg width="${largeur}" height="${hauteurTotale}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="charte" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:rgb(${rgb.r},${rgb.g},${rgb.b})"/>
      <stop offset="100%" style="stop-color:rgb(${rgbFonce.r},${rgbFonce.g},${rgbFonce.b})"/>
    </linearGradient>
  </defs>
  <rect width="${largeur}" height="${hauteurTotale}" fill="#FFFFFF"/>
  <rect width="${largeur}" height="${hauteurHeader}" fill="url(#charte)"/>
  <text x="30" y="42" font-family="sans-serif" font-size="17" font-weight="bold" fill="rgba(255,255,255,0.65)" letter-spacing="3">TERRAIN.SN</text>
  <text x="30" y="92" font-family="sans-serif" font-size="30" font-weight="bold" fill="#FFFFFF">${nomAffiche}</text>
  <rect y="${hauteurHeader + hauteurQr}" width="${largeur}" height="${hauteurFooter}" fill="url(#charte)"/>
  <text x="${largeur / 2}" y="${hauteurHeader + hauteurQr + 42}" font-family="monospace" font-size="27" font-weight="bold" fill="#FFFFFF" text-anchor="middle" letter-spacing="4">${codeAffiche}</text>
  <text x="${largeur / 2}" y="${hauteurHeader + hauteurQr + 74}" font-family="sans-serif" font-size="16" fill="rgba(255,255,255,0.88)" text-anchor="middle">${escapeXml(creneau)}</text>
</svg>`;

  const buffer = await sharp(Buffer.from(svg))
    .composite([{ input: qrBuffer, left: Math.round((largeur - tailleQr) / 2), top: hauteurHeader + 18 }])
    .png()
    .toBuffer();

  const safeCode = String(codeReservation || 'qr').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cheminAbsolu = cheminSortie || path.join(UPLOAD_ROOT, 'qr', `${safeCode}.png`);
  fs.mkdirSync(path.dirname(cheminAbsolu), { recursive: true });
  fs.writeFileSync(cheminAbsolu, buffer);

  return { url: `/uploads/qr/${path.basename(cheminAbsolu)}`, cheminAbsolu, buffer };
}

module.exports = { genererQRCodeStylise, normaliserCouleur, formaterDateCourt, COULEUR_DEFAUT };
