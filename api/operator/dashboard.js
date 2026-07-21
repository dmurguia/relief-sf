const { authorized, configured, count, rejectUnauthorized, signedPhotoUrl, supabase } = require('./_shared');

const decision = (row) => row.ai_review?.decision || null;
const titleForUpdate = (row) => row.restrooms?.name || 'Restroom update';
const defaultAutopilot = { enabled: false, confidenceThreshold: 0.92, configured: false };

async function loadAutopilot() {
  try {
    const { body } = await supabase('/rest/v1/operator_autopilot_settings?id=eq.true&select=enabled,confidence_threshold');
    const setting = body?.[0];
    return setting ? { enabled: Boolean(setting.enabled), confidenceThreshold: Number(setting.confidence_threshold), configured: true } : defaultAutopilot;
  } catch {
    return defaultAutopilot;
  }
}

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
    const [suggestionsResponse, updatesResponse, published, candidateLeads, autopilot] = await Promise.all([
      supabase('/rest/v1/place_suggestions?select=*&order=created_at.desc&limit=250'),
      supabase('/rest/v1/restroom_updates?select=*,restrooms(name)&order=created_at.desc&limit=250'),
      count('/rest/v1/restrooms?verification_status=eq.approved&select=id'),
      count('/rest/v1/venue_candidates?select=id&status=neq.approved'),
      loadAutopilot(),
    ]);
    const rows = [
      ...(await formatRows(suggestionsResponse.body || [], 'place_suggestion')),
      ...(await formatRows(updatesResponse.body || [], 'restroom_update')),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const reviewed = rows.filter((row) => row.aiReviewStatus === 'reviewed');
    const gptApproved = rows.filter((row) => row.status === 'pending' && row.aiReviewStatus === 'reviewed' && decision(row) === 'eligible_for_human_publish');
    const gptRejected = rows.filter((row) => row.status === 'pending' && row.aiReviewStatus === 'reviewed' && decision(row) === 'reject');
    const operatorApproved = rows.filter((row) => row.status === 'approved');
    // Keep operator decisions alongside model rejections. Both remain private,
    // auditable records and can be amended/re-run from the rejected queue.
    const operatorRejected = rows.filter((row) => row.status === 'rejected');
    const rejected = [...gptRejected, ...operatorRejected.filter((row) => !gptRejected.some((item) => item.id === row.id && item.entityType === row.entityType))];
    // Only model uncertainty or an unfinished/error state needs a human. A
    // reviewed rejection is never allowed to leak back into this queue.
    const needsJudgment = rows.filter((row) => row.status === 'pending' && (
      row.aiReviewStatus === 'queued' || row.aiReviewStatus === 'reviewing' || row.aiReviewStatus === 'error' || decision(row) === 'needs_human_review'
    ));
    return res.status(200).json({
      stats: { published, candidateLeads, gptApproved: gptApproved.length, operatorApproved: operatorApproved.length, needsJudgment: needsJudgment.length, gptRejected: rejected.length, reviewed: reviewed.length },
      needsJudgment,
      gptApproved,
      operatorApproved,
      rejected,
      audit: rows,
      autopilot,
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Could not load the operator workspace.' });
  }
};
