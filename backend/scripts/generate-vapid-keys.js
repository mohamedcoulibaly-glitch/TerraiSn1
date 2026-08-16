/**
 * Génère une paire de clés VAPID pour Web Push.
 * Usage: node scripts/generate-vapid-keys.js
 */
const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();

console.log('\n=== Clés VAPID TerrainSN ===\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:contact@terrainsn.com');
console.log('\nAjoutez ces variables dans backend/.env\n');
