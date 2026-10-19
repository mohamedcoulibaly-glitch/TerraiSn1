/**
 * Gateway de statut paiement pour la réconciliation IPN (US-01).
 * Ne confirme jamais sans preuve distante : en simulation ou sans API → 'pending'.
 */
const paymentService = require('./payment');
const { estSimulation } = require('../lib/paymentGateway');

/**
 * @param {string} refCommand
 * @returns {Promise<'paid'|'failed'|'pending'>}
 */
async function statutPaiement(refCommand) {
  const ref = String(refCommand || '').trim();
  if (!ref) return 'pending';

  if (estSimulation()) return 'pending';

  try {
    const adapter = paymentService.getLiveAdapter();
    if (adapter && typeof adapter.getPaymentStatus === 'function') {
      const remote = await adapter.getPaymentStatus(ref);
      const normalized = String(remote || 'pending').toLowerCase();
      if (normalized === 'paid' || normalized === 'success' || normalized === 'completed') return 'paid';
      if (normalized === 'failed' || normalized === 'canceled' || normalized === 'cancelled' || normalized === 'refunded') {
        return 'failed';
      }
      return 'pending';
    }
  } catch {
    return 'pending';
  }
  return 'pending';
}

module.exports = { statutPaiement };
