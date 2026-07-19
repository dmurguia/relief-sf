// Operator-only helper. Never expose SUPABASE_SERVICE_ROLE_KEY to the client or Vercel.
const [command, id] = process.argv.slice(2);
const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const reviewToken = process.env.RELIEF_REVIEW_TOKEN;

if (!url || !serviceKey) throw new Error('Set SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY locally.');
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
const request = async (path, options = {}) => {
  const response = await fetch(`${url}${path}`, { headers, ...options });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message ?? body?.error ?? `Request failed (${response.status})`);
  return body;
};

if (command === 'pending') {
  const [updates, candidates] = await Promise.all([
    request('/rest/v1/restroom_updates?select=id,restroom_id,note,access_detail,cleanliness_rating,photo_path,ai_review,created_at&status=eq.pending&order=created_at.desc'),
    request('/rest/v1/venue_candidates?select=id,name,address,venue_type,source_name,source_url,evidence_note,ai_proposal,created_at&status=eq.pending&order=created_at.desc'),
  ]);
  console.log(JSON.stringify({ pendingUpdates: updates, pendingCandidates: candidates }, null, 2));
} else if (command === 'review-photo' && id) {
  if (!reviewToken) throw new Error('Set RELIEF_REVIEW_TOKEN locally.');
  const response = await fetch(`${url}/functions/v1/enrich-restroom-photo`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-relief-review-token': reviewToken }, body: JSON.stringify({ updateId: id }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'GPT-5.6 review failed');
  console.log(JSON.stringify(body, null, 2));
} else if (command === 'approve-update' && id) {
  await request(`/rest/v1/restroom_updates?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify({ status: 'approved' }) });
  console.log(`Approved restroom update ${id}. Apply its evidence to a restroom record only after human review.`);
} else {
  console.log('Usage: node scripts/moderate.mjs pending | review-photo UPDATE_ID | approve-update UPDATE_ID');
  process.exitCode = 1;
}
