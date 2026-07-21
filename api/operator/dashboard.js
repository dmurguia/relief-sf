const { authorized, configured, count, rejectUnauthorized, signedPhotoUrl, supabase } = require('./_shared');

const decision = (row) => row.ai_review?.decision || null;
const titleForUpdate = (row) => row.restrooms?.name || 'Restroom update';

async function formatRows(rows, entityType) {
  return Promise.all(rows.map(async (row) => ({
    id: row.id,
    entityType,
    title: entityType === 'place_suggestion' ? row.name : titleForUpdate(row),
    subtitle: entityType === 'place_suggestion' ? row.address : row.restroom_id,
    category: row.category || null,
    note: row.note || '',
    accessDetail: row.access_detail || null,
    cleanlinessRating: row.cleanliness_rating || null,
    status: row.status,
    createdAt: row.created_at,
    aiReviewStatus: row.ai_review_status || 'queued',
    aiReviewedAt: row.ai_reviewed_at || null,
    aiReviewError: row.ai_review_error || null,
    aiReview: row.ai_review || null,
    photoUrl: await signedPhotoUrl(row.photo_path),
    photoPath: row.photo_path || null,
  })));
}

module.exports = async function dashboard(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  if (!configured()) return res.status(503).json({ error: 'Operator API is not configured. Add OPERATOR_PASSWORD, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY in Vercel.' });
  if (!authorized(req)) return rejectUnauthorized(res);
  try {
    const [suggestionsResponse, updatesResponse, published, candidateLeads] = await Promise.all([
      supabase('/rest/v1/place_suggestions?select=*&order=created_at.desc&limit=250'),
      supabase('/rest/v1/restroom_updates?select=*,restrooms(name)&order=created_at.desc&limit=250'),
      count('/rest/v1/restrooms?verification_status=eq.approved&select=id'),
      count('/rest/v1/venue_candidates?select=id'),
    ]);
    const rows = [
      ...(await formatRows(suggestionsResponse.body || [], 'place_suggestion')),
      ...(await formatRows(updatesResponse.body || [], 'restroom_update')),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const reviewed = rows.filter((row) => row.aiReviewStatus === 'reviewed');
    const aiReady = reviewed.filter((row) => decision(row) === 'eligible_for_human_publish');
    const gptRejected = reviewed.filter((row) => decision(row) === 'reject');
    const humanReview = rows.filter((row) => row.status === 'pending' && row.aiReviewStatus === 'reviewed' && decision(row) !== 'reject');
    return res.status(200).json({
      stats: { published, candidateLeads, aiReady: aiReady.length, humanReview: humanReview.length, gptRejected: gptRejected.length, reviewed: reviewed.length },
      queue: humanReview,
      audit: rows,
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Could not load the operator workspace.' });
  }
};
