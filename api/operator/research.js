const { authorized, configured, count, rejectUnauthorized, supabase } = require('./_shared');

const select = 'id,name,address,latitude,longitude,venue_type,source_name,source_url,source_license,source_retrieved_at,evidence_note,ai_proposal,status';
const outputText = (data) => typeof data.output_text === 'string' ? data.output_text : Array.isArray(data.output)
  ? data.output.flatMap((item) => item.content || []).filter((item) => item.type === 'output_text' && typeof item.text === 'string').map((item) => item.text).join('\n') : '';
const parseJson = (value) => JSON.parse(value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));

async function latestLeads() {
  const [triaged, fresh] = await Promise.all([
    supabase(`/rest/v1/venue_candidates?select=${select}&ai_proposal=not.is.null&order=source_retrieved_at.asc&limit=100`),
    supabase(`/rest/v1/venue_candidates?select=${select}&ai_proposal=is.null&status=eq.pending&order=source_retrieved_at.asc&limit=40`),
  ]);
  return [...(triaged.body || []), ...(fresh.body || [])];
}

async function researchData() {
  const [leads, total, triaged, rejected] = await Promise.all([
    latestLeads(),
    count('/rest/v1/venue_candidates?select=id'),
    count('/rest/v1/venue_candidates?select=id&ai_proposal=not.is.null'),
    count('/rest/v1/venue_candidates?select=id&status=eq.rejected'),
  ]);
  return { stats: { total, triaged, remaining: Math.max(0, total - triaged), rejected }, leads };
}

module.exports = async function research(req, res) {
  if (!configured()) return res.status(503).json({ error: 'Operator API is not configured.' });
  if (!authorized(req)) return rejectUnauthorized(res);
  if (req.method === 'GET') {
    try { return res.status(200).json(await researchData()); }
    catch (error) { return res.status(500).json({ error: error instanceof Error ? error.message : 'Could not load research leads.' }); }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'Research triage needs OPENAI_API_KEY in Vercel. Keep it server-only.' });
  const requestedIds = Array.isArray(req.body?.ids) ? req.body.ids.filter((id) => typeof id === 'string' && id.length <= 80).slice(0, 100) : [];
  const limit = requestedIds.length || 100;
  try {
    const selection = requestedIds.length ? `&id=in.(${requestedIds.map(encodeURIComponent).join(',')})` : '';
    const { body: leads } = await supabase(`/rest/v1/venue_candidates?select=${select}&ai_proposal=is.null&status=eq.pending${selection}&order=source_retrieved_at.asc&limit=${limit}`);
    if (!leads?.length) return res.status(200).json({ ok: true, processed: 0, message: 'No untriaged source leads remain.' });
    const input = leads.map((lead) => ({ id: lead.id, name: lead.name, address: lead.address, venue_type: lead.venue_type, source_name: lead.source_name, source_url: lead.source_url, source_license: lead.source_license, evidence_note: lead.evidence_note }));
    const prompt = `You route Relief research leads. These are open-data venue leads, NOT verified restrooms. For each input lead, decide one route: "evidence_collection" only if the source itself plausibly points to a public restroom/facility worth verifying; "needs_judgment" for a potentially relevant venue without adequate restroom evidence; or "reject" for clearly irrelevant, duplicate-looking, or unusable leads. Never claim the venue has a restroom, never invent hours/access, and never use an eligible/publish decision. Return ONLY JSON: {"reviews":[{"id":"exact input id","route":"evidence_collection|needs_judgment|reject","confidence":0.0,"reason":"max 120 chars","evidence_needed":"max 120 chars"}]}. Return exactly one review for every input id. Inputs: ${JSON.stringify(input)}`;
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-5.6', input: prompt }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'OpenAI source triage failed.');
    const reviews = parseJson(outputText(data)).reviews;
    if (!Array.isArray(reviews)) throw new Error('GPT returned an invalid source-triage response.');
    const byId = new Map(reviews.filter((review) => input.some((lead) => lead.id === review.id)).map((review) => [review.id, review]));
    const processedAt = new Date().toISOString();
    await Promise.all(leads.map((lead) => {
      const review = byId.get(lead.id) || { route: 'needs_judgment', confidence: 0, reason: 'No structured model route returned.', evidence_needed: 'Review source manually.' };
      const route = ['evidence_collection', 'needs_judgment', 'reject'].includes(review.route) ? review.route : 'needs_judgment';
      const ai_proposal = { ...review, route, pipeline: 'source_triage', model: 'gpt-5.6', processed_at: processedAt };
      return supabase(`/rest/v1/venue_candidates?id=eq.${encodeURIComponent(lead.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ai_proposal, status: route === 'reject' ? 'rejected' : 'pending' }) });
    }));
    const routeCounts = Array.from(byId.values()).reduce((acc, review) => ({ ...acc, [review.route]: (acc[review.route] || 0) + 1 }), {});
    return res.status(200).json({ ok: true, processed: leads.length, routeCounts, message: `GPT-5.6 triaged ${leads.length} source leads. No lead was published.` });
  } catch (error) { return res.status(500).json({ error: error instanceof Error ? error.message : 'Could not process source leads.' }); }
};
