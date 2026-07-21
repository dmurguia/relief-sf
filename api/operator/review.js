const { authorized, configured, rejectUnauthorized, supabase } = require('./_shared');

const validEntityTypes = new Set(['place_suggestion', 'restroom_update']);
const validActions = new Set(['approve', 'reject']);
const tagList = (review, access) => Array.from(new Set([
  ...(Array.isArray(review?.proposed_tags) ? review.proposed_tags : []),
  ...(access ? [access] : []),
].filter((tag) => typeof tag === 'string' && tag.trim().length > 0))).slice(0, 8);

module.exports = async function review(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!configured()) return res.status(503).json({ error: 'Operator API is not configured. Add the Vercel operator secrets.' });
  if (!authorized(req)) return rejectUnauthorized(res);
  const { entityType, id, action } = req.body || {};
  if (!validEntityTypes.has(entityType) || typeof id !== 'string' || !validActions.has(action)) return res.status(400).json({ error: 'Invalid review request.' });
  try {
    const table = entityType === 'place_suggestion' ? 'place_suggestions' : 'restroom_updates';
    const { body: rows } = await supabase(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=*`);
    const row = rows?.[0];
    if (!row) return res.status(404).json({ error: 'Submission not found.' });
    if (action === 'approve' && entityType === 'place_suggestion') {
      const publicRecord = {
        id: `community-${row.id}`,
        name: row.name,
        address: row.address,
        neighborhood: 'San Francisco',
        category: row.category,
        latitude: row.latitude,
        longitude: row.longitude,
        hours: 'Check posted hours',
        access: row.access_detail || 'Check with staff',
        tags: tagList(row.ai_review, row.access_detail),
        description: row.ai_review?.description || row.note || 'Community-submitted restroom information. Confirm details when you arrive.',
        source_name: 'Community submission',
        source_tier: 'community_verified',
        verification_status: 'approved',
      };
      await supabase('/rest/v1/restrooms?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(publicRecord) });
    }
    await supabase(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: action === 'approve' ? 'approved' : 'rejected' }) });
    const message = action === 'approve' && entityType === 'place_suggestion'
      ? 'Published to the public map.'
      : action === 'approve' ? 'Evidence approved. The restroom record remains unchanged until a later editorial update.' : 'Rejected and retained in the private audit trail.';
    return res.status(200).json({ ok: true, message });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Could not save the review.' });
  }
};
