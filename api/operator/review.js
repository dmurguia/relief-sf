const { authorized, configured, rejectUnauthorized, supabase } = require('./_shared');

const validEntityTypes = new Set(['place_suggestion', 'restroom_update']);
const validActions = new Set(['approve', 'reject', 'auto_approve_all', 'edit_and_requeue']);
const tagList = (review, access) => Array.from(new Set([
  ...(Array.isArray(review?.proposed_tags) ? review.proposed_tags : []),
  ...(access ? [access] : []),
].filter((tag) => typeof tag === 'string' && tag.trim().length > 0))).slice(0, 8);

const actionLog = (review, action) => ({
  ...(review && typeof review === 'object' ? review : {}),
  operator_actions: [...(Array.isArray(review?.operator_actions) ? review.operator_actions : []), { action, at: new Date().toISOString() }].slice(-20),
});

async function publishPlaceSuggestion(row, action = 'approved') {
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
  await supabase(`/rest/v1/place_suggestions?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'approved', ai_review: actionLog(row.ai_review, action) }) });
}

async function approveUpdate(row, action = 'approved') {
  await supabase(`/rest/v1/restroom_updates?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'approved', ai_review: actionLog(row.ai_review, action) }) });
}

async function requeue(row, table, note) {
  const nextNote = typeof note === 'string' ? note.trim() : row.note;
  if (table === 'restroom_updates' && (!nextNote || nextNote.length < 3)) throw new Error('Updates need a brief note before re-running GPT review.');
  if (nextNote && nextNote.length > 1000) throw new Error('Notes must be 1,000 characters or fewer.');
  const amendedReview = actionLog(row.ai_review, 'edited_and_requeued');
  await supabase(`/rest/v1/${table}?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ note: nextNote || null, status: 'pending', ai_review: amendedReview, ai_review_status: 'queued', ai_review_error: null, ai_reviewed_at: null }) });
  const reviewResponse = await fetch(`${process.env.SUPABASE_URL}/functions/v1/review-submission`, {
    method: 'POST', headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ entityType: table === 'place_suggestions' ? 'place_suggestion' : 'restroom_update', submissionId: row.id }),
  });
  if (!reviewResponse.ok) throw new Error('The submission was saved, but GPT could not be re-queued.');
}

module.exports = async function review(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!configured()) return res.status(503).json({ error: 'Operator API is not configured. Add the Vercel operator secrets.' });
  if (!authorized(req)) return rejectUnauthorized(res);
  const { entityType, id, action } = req.body || {};
  if (!validActions.has(action)) return res.status(400).json({ error: 'Invalid review request.' });
  try {
    if (action === 'auto_approve_all') {
      const [suggestions, updates] = await Promise.all([
        supabase('/rest/v1/place_suggestions?select=*&status=eq.pending&ai_review_status=eq.reviewed&limit=250'),
        supabase('/rest/v1/restroom_updates?select=*&status=eq.pending&ai_review_status=eq.reviewed&limit=250'),
      ]);
      const approvedSuggestions = (suggestions.body || []).filter((row) => row.ai_review?.decision === 'eligible_for_human_publish');
      const approvedUpdates = (updates.body || []).filter((row) => row.ai_review?.decision === 'eligible_for_human_publish');
      await Promise.all([...approvedSuggestions.map((row) => publishPlaceSuggestion(row, 'auto_approved')), ...approvedUpdates.map((row) => approveUpdate(row, 'auto_approved'))]);
      return res.status(200).json({ ok: true, message: `Auto-approved ${approvedSuggestions.length + approvedUpdates.length} GPT-approved record${approvedSuggestions.length + approvedUpdates.length === 1 ? '' : 's'}.` });
    }
    if (!validEntityTypes.has(entityType) || typeof id !== 'string') return res.status(400).json({ error: 'Invalid review request.' });
    const table = entityType === 'place_suggestion' ? 'place_suggestions' : 'restroom_updates';
    const { body: rows } = await supabase(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=*`);
    const row = rows?.[0];
    if (!row) return res.status(404).json({ error: 'Submission not found.' });
    if (action === 'edit_and_requeue') {
      await requeue(row, table, req.body?.note);
      return res.status(200).json({ ok: true, message: 'Saved and sent back to GPT review.' });
    }
    if (action === 'approve' && entityType === 'place_suggestion') await publishPlaceSuggestion(row);
    else if (action === 'approve') await approveUpdate(row);
    else await supabase(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'rejected', ai_review: actionLog(row.ai_review, 'rejected') }) });
    const message = action === 'approve' && entityType === 'place_suggestion'
      ? 'Published to the public map.'
      : action === 'approve' ? 'Evidence approved. The restroom record remains unchanged until a later editorial update.' : 'Rejected and retained in the private audit trail.';
    return res.status(200).json({ ok: true, message });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Could not save the review.' });
  }
};
