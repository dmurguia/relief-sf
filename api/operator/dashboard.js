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

function formatResearchRows(rows) {
  return rows.map((row) => {
    const route = row.ai_proposal?.route;
    const modelDecision = route === 'reject'
      ? 'reject'
      : route === 'needs_judgment' || route === 'evidence_collection'
        ? 'needs_human_review'
        : 'eligible_for_human_publish';
    const operatorAction = row.ai_proposal?.operator_action;
    return {
      id: row.id,
      entityType: 'research_lead',
      title: row.name,
      subtitle: row.address || row.venue_type || 'Open-data venue lead',
      category: row.venue_type || null,
      note: row.evidence_note || '',
      accessDetail: null,
      cleanlinessRating: null,
      status: row.status,
      createdAt: row.source_retrieved_at || row.ai_proposal?.processed_at || new Date().toISOString(),
      aiReviewStatus: 'reviewed',
      aiReviewedAt: row.ai_proposal?.processed_at || null,
      aiReviewError: null,
      aiReview: {
        decision: modelDecision,
        confidence: row.ai_proposal?.confidence,
        reason: row.ai_proposal?.reason,
        description: row.ai_proposal?.evidence_needed,
        proposed_tags: ['research_lead', row.venue_type].filter(Boolean),
        concerns: row.ai_proposal?.evidence_needed ? [row.ai_proposal.evidence_needed] : [],
        operator_actions: operatorAction ? [operatorAction] : route === 'publish_to_map' ? [{ action: 'published_to_map', actor: 'autopilot', at: row.ai_proposal?.processed_at }] : [],
        route,
      },
      photoUrl: null,
      photoPath: null,
      sourceName: row.source_name,
      sourceUrl: row.source_url,
    };
  });
}

module.exports = async function dashboard(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  if (!configured()) return res.status(503).json({ error: 'Operator API is not configured. Add OPERATOR_PASSWORD, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY in Vercel.' });
  if (!authorized(req)) return rejectUnauthorized(res);
  try {
    const [suggestionsResponse, updatesResponse, researchResponse, published, candidateLeads, autopilot] = await Promise.all([
      supabase('/rest/v1/place_suggestions?select=*&order=created_at.desc&limit=250'),
      supabase('/rest/v1/restroom_updates?select=*,restrooms(name)&order=created_at.desc&limit=250'),
      supabase('/rest/v1/venue_candidates?select=id,name,address,venue_type,source_name,source_url,source_retrieved_at,evidence_note,ai_proposal,status,published_restroom_id&ai_proposal=not.is.null&order=source_retrieved_at.desc&limit=250'),
      count('/rest/v1/restrooms?verification_status=eq.approved&select=id'),
      count('/rest/v1/venue_candidates?select=id&status=eq.pending&ai_proposal=is.null'),
      loadAutopilot(),
    ]);
    const rows = [
      ...(await formatRows(suggestionsResponse.body || [], 'place_suggestion')),
      ...(await formatRows(updatesResponse.body || [], 'restroom_update')),
      ...formatResearchRows(researchResponse.body || []),
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
