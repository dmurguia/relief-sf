const { authorized, configured, rejectUnauthorized, supabase } = require('./_shared');

const fallback = { enabled: false, confidenceThreshold: 0.92, configured: false };

async function readPolicy() {
  try {
    const { body } = await supabase('/rest/v1/operator_autopilot_settings?id=eq.true&select=enabled,confidence_threshold');
    const policy = body?.[0];
    return policy ? { enabled: Boolean(policy.enabled), confidenceThreshold: Number(policy.confidence_threshold), configured: true } : fallback;
  } catch {
    return fallback;
  }
}

module.exports = async function autopilot(req, res) {
  if (!configured()) return res.status(503).json({ error: 'Operator API is not configured.' });
  if (!authorized(req)) return rejectUnauthorized(res);
  if (req.method === 'GET') return res.status(200).json(await readPolicy());
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const enabled = Boolean(req.body?.enabled);
  const confidenceThreshold = Number(req.body?.confidenceThreshold);
  if (![0.9, 0.92, 0.95].includes(confidenceThreshold)) return res.status(400).json({ error: 'Choose a 90%, 92%, or 95% confidence threshold.' });
  try {
    const { body } = await supabase('/rest/v1/operator_autopilot_settings?id=eq.true', {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ enabled, confidence_threshold: confidenceThreshold, updated_at: new Date().toISOString() }),
    });
    if (!Array.isArray(body) || body.length !== 1) {
      throw new Error('Autopilot storage is not initialized. Run supabase/add-autopilot-policy.sql once, then retry.');
    }
    return res.status(200).json({ enabled, confidenceThreshold, configured: true });
  } catch {
    return res.status(503).json({ error: 'Autopilot storage is not initialized. Run supabase/add-autopilot-policy.sql once, then retry.' });
  }
};
