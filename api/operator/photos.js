const { authorized, configured, rejectUnauthorized, supabase } = require('./_shared');
const { promoteApprovedPhoto } = require('./_photos');

async function syncOne(restroomId, photoPath) {
  if (!restroomId || !photoPath) return false;
  const { body } = await supabase(`/rest/v1/restrooms?id=eq.${encodeURIComponent(restroomId)}&select=id,public_photo_path`);
  if (!body?.[0] || body[0].public_photo_path) return false;
  const publicPhotoPath = await promoteApprovedPhoto(photoPath, restroomId);
  await supabase(`/rest/v1/restrooms?id=eq.${encodeURIComponent(restroomId)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ public_photo_path: publicPhotoPath, updated_at: new Date().toISOString() }),
  });
  return true;
}

module.exports = async function photos(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!configured()) return res.status(503).json({ error: 'Operator API is not configured.' });
  if (!authorized(req)) return rejectUnauthorized(res);
  try {
    const [suggestions, updates] = await Promise.all([
      supabase('/rest/v1/place_suggestions?select=id,photo_path&status=eq.approved&photo_path=not.is.null&limit=100'),
      supabase('/rest/v1/restroom_updates?select=restroom_id,photo_path&status=eq.approved&photo_path=not.is.null&limit=100'),
    ]);
    const results = await Promise.all([
      ...(suggestions.body || []).map((row) => syncOne(`community-${row.id}`, row.photo_path)),
      ...(updates.body || []).map((row) => syncOne(row.restroom_id, row.photo_path)),
    ]);
    return res.status(200).json({ promoted: results.filter(Boolean).length });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Could not publish approved photos.' });
  }
};
