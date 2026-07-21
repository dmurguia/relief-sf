// Publicly queueable, server-side review for new anonymous submissions.
// It never exposes OpenAI or Supabase service credentials to the client.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Content-Type': 'application/json',
};

type EntityType = 'place_suggestion' | 'restroom_update';
type Submission = {
  id: string;
  note: string | null;
  access_detail: string | null;
  cleanliness_rating: number | null;
  photo_path: string | null;
  ai_review_status?: string;
  name?: string;
  address?: string;
  category?: string;
  latitude?: number;
  longitude?: number;
  restroom_id?: string;
};

type AiReview = {
  decision?: string;
  confidence?: number;
  is_restroom_photo?: boolean;
  safe_to_publish?: boolean;
  proposed_tags?: string[];
  description?: string;
  concerns?: string[];
  operator_actions?: Array<Record<string, unknown>>;
};

type AutopilotPolicy = { enabled: boolean; confidence_threshold: number };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const uniqueTags = (review: AiReview) => Array.from(new Set((review.proposed_tags || []).filter((tag) => typeof tag === 'string' && tag.trim().length > 0))).slice(0, 8);
const actionedReview = (review: AiReview, action: string, policy: AutopilotPolicy) => ({ ...review, operator_actions: [...(Array.isArray(review.operator_actions) ? review.operator_actions : []), { action, actor: 'autopilot', at: new Date().toISOString(), policy: { confidence_threshold: policy.confidence_threshold } }].slice(-20) });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const { entityType, submissionId } = await request.json().catch(() => ({}));
  if (!['place_suggestion', 'restroom_update'].includes(entityType) || typeof submissionId !== 'string') {
    return json({ error: 'entityType and submissionId are required' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!supabaseUrl || !serviceKey || !openaiKey) return json({ error: 'Review service is not configured' }, 503);

  const table = entityType === 'place_suggestion' ? 'place_suggestions' : 'restroom_updates';
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const promoteApprovedPhoto = async (photoPath: string | null, restroomId: string) => {
    if (!photoPath) return null;
    const signedResponse = await fetch(`${supabaseUrl}/storage/v1/object/sign/restroom-submissions/${photoPath}`, {
      method: 'POST', headers, body: JSON.stringify({ expiresIn: 120 }),
    });
    const signed = await signedResponse.json().catch(() => null);
    if (!signedResponse.ok || !signed?.signedURL) throw new Error('Autopilot could not read the approved photo.');
    const source = await fetch(`${supabaseUrl}/storage/v1${signed.signedURL}`);
    if (!source.ok) throw new Error('Autopilot could not download the approved photo.');
    const contentType = source.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new Error('Autopilot received an unsupported photo type.');
    const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    const publicPath = `verified/${restroomId}.${extension}`;
    const uploaded = await fetch(`${supabaseUrl}/storage/v1/object/restroom-photos/${publicPath}`, {
      method: 'POST', headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'true' }, body: await source.arrayBuffer(),
    });
    if (!uploaded.ok) throw new Error('Autopilot could not publish the approved photo.');
    return publicPath;
  };
  const rowResponse = await fetch(`${supabaseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(submissionId)}&select=*`, { headers });
  const [submission] = await rowResponse.json().catch(() => []) as Submission[];
  if (!submission) return json({ error: 'Submission not found' }, 404);
  if (submission.ai_review_status === 'reviewed' || submission.ai_review_status === 'reviewing') return json({ status: submission.ai_review_status });

  const setStatus = async (body: Record<string, unknown>) => fetch(`${supabaseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(submissionId)}`, {
    method: 'PATCH', headers, body: JSON.stringify(body),
  });

  const readAutopilot = async (): Promise<AutopilotPolicy> => {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/operator_autopilot_settings?id=eq.true&select=enabled,confidence_threshold`, { headers });
      const [policy] = await response.json().catch(() => []);
      return policy && policy.enabled ? { enabled: true, confidence_threshold: Number(policy.confidence_threshold) } : { enabled: false, confidence_threshold: 0.92 };
    } catch {
      return { enabled: false, confidence_threshold: 0.92 };
    }
  };

  const publishAutopilot = async (review: AiReview, policy: AutopilotPolicy) => {
    const taggedReview = actionedReview(review, entityType === 'place_suggestion' ? 'gpt_auto_published' : 'gpt_auto_applied', policy);
    if (entityType === 'place_suggestion') {
      const restroomId = `community-${submission.id}`;
      const publicPhotoPath = await promoteApprovedPhoto(submission.photo_path, restroomId);
      const publicRecord = {
        id: restroomId,
        name: submission.name,
        address: submission.address,
        neighborhood: 'San Francisco',
        category: submission.category,
        latitude: submission.latitude,
        longitude: submission.longitude,
        hours: 'Check posted hours',
        access: submission.access_detail || 'Check with staff',
        tags: uniqueTags(review),
        description: review.description || submission.note || 'Community-submitted restroom information. Confirm details when you arrive.',
        source_name: 'Community submission · GPT autopilot',
        source_tier: 'community_verified',
        public_photo_path: publicPhotoPath,
        verification_status: 'approved',
      };
      const publish = await fetch(`${supabaseUrl}/rest/v1/restrooms?on_conflict=id`, { method: 'POST', headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(publicRecord) });
      if (!publish.ok) throw new Error('Autopilot could not publish the suggested place.');
    } else {
      const source = await fetch(`${supabaseUrl}/rest/v1/restrooms?id=eq.${encodeURIComponent(submission.restroom_id || '')}&select=id,access,tags,public_photo_path`, { headers });
      const [restroom] = await source.json().catch(() => []);
      if (!restroom) throw new Error('Autopilot could not find the existing restroom.');
      const tags = Array.from(new Set([...(Array.isArray(restroom.tags) ? restroom.tags : []), ...uniqueTags(review)]));
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (submission.access_detail) patch.access = submission.access_detail;
      if (tags.length !== (restroom.tags || []).length) patch.tags = tags;
      if (submission.photo_path) patch.public_photo_path = await promoteApprovedPhoto(submission.photo_path, restroom.id);
      const updated = await fetch(`${supabaseUrl}/rest/v1/restrooms?id=eq.${encodeURIComponent(submission.restroom_id || '')}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
      if (!updated.ok) throw new Error('Autopilot could not apply the update.');
    }
    const finalized = await setStatus({ status: 'approved', ai_review: taggedReview, ai_review_status: 'reviewed', ai_reviewed_at: new Date().toISOString(), ai_review_error: null });
    if (!finalized.ok) throw new Error('Autopilot could not finalize the review.');
  };

  const review = async () => {
    await setStatus({ ai_review_status: 'reviewing', ai_review_error: null });
    try {
      let imageContent: { type: 'input_image'; image_url: string } | null = null;
      if (submission.photo_path) {
        const signed = await fetch(`${supabaseUrl}/storage/v1/object/sign/restroom-submissions/${submission.photo_path}`, {
          method: 'POST', headers, body: JSON.stringify({ expiresIn: 120 }),
        });
        const signedData = await signed.json();
        if (signed.ok && signedData.signedURL) imageContent = { type: 'input_image', image_url: `${supabaseUrl}/storage/v1${signedData.signedURL}` };
      }

      const identity = entityType === 'place_suggestion'
        ? { name: submission.name, address: submission.address, category: submission.category }
        : { restroom_id: submission.restroom_id };
      const prompt = `You are the evidence reviewer for Relief, a restroom finder. Review one ${entityType.replace('_', ' ')}. Return ONLY valid JSON: {"decision":"eligible_for_human_publish|needs_human_review|reject","confidence":0.0,"is_restroom_photo":true,"safe_to_publish":true,"supported_facts":["short strings"],"proposed_tags":["accessible|all_gender|clean|spacious|well_lit|stall|sink|unknown"],"description":"max 240 characters","concerns":["short strings"],"reason":"max 180 characters"}. Only treat facts as supported when they are visible in the photo or explicitly stated by the contributor. Never infer hours, price, door codes, business policy, accessibility compliance, or whether a venue has a restroom from its category. If there is no photo, do not claim visual evidence. Reject photos with people, readable codes, personal information, or a non-restroom subject. This is an AI recommendation. A separate operator-controlled policy may publish only when a strict photo, safety, place, and confidence gate passes; never claim that policy was passed. Identity: ${JSON.stringify(identity)}. Contributor note: ${JSON.stringify(submission.note ?? '')}. Access detail: ${JSON.stringify(submission.access_detail ?? '')}. Cleanliness rating: ${JSON.stringify(submission.cleanliness_rating ?? null)}.`;
      const content: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }> = [{ type: 'input_text', text: prompt }];
      if (imageContent) content.push(imageContent);
      const aiResponse = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-5.6', input: [{ role: 'user', content }] }),
      });
      const aiData = await aiResponse.json();
      if (!aiResponse.ok) throw new Error(aiData.error?.message ?? 'OpenAI review failed');
      // The REST response stores text inside output[].content[].text. Some SDKs
      // expose output_text as a convenience field, but raw HTTP does not.
      const outputText = typeof aiData.output_text === 'string'
        ? aiData.output_text
        : Array.isArray(aiData.output)
          ? aiData.output.flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item.content ?? [])
            .filter((item: { type?: string; text?: string }) => item.type === 'output_text' && typeof item.text === 'string')
            .map((item: { text?: string }) => item.text ?? '')
            .join('\n')
          : '';
      if (!outputText.trim()) throw new Error('OpenAI returned no review text');
      const parsed = JSON.parse(outputText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as AiReview;
      const policy = await readAutopilot();
      const safeConcerns = Array.isArray(parsed.concerns) && parsed.concerns.length === 0;
      const validPlace = entityType === 'restroom_update' || (Boolean(submission.name && submission.address && submission.category) && Number.isFinite(submission.latitude) && Number.isFinite(submission.longitude));
      const eligibleForAutopilot = policy.enabled && Boolean(submission.photo_path) && validPlace
        && parsed.decision === 'eligible_for_human_publish' && parsed.is_restroom_photo === true && parsed.safe_to_publish === true
        && safeConcerns && typeof parsed.confidence === 'number' && parsed.confidence >= policy.confidence_threshold;
      if (eligibleForAutopilot) {
        try {
          await publishAutopilot(parsed, policy);
        } catch (error) {
          await setStatus({ ai_review: parsed, ai_review_status: 'reviewed', ai_reviewed_at: new Date().toISOString(), ai_review_error: error instanceof Error ? `Autopilot held: ${error.message.slice(0, 420)}` : 'Autopilot held for manual review.' });
        }
      } else {
        await setStatus({ ai_review: parsed, ai_review_status: 'reviewed', ai_reviewed_at: new Date().toISOString(), ai_review_error: null });
      }
    } catch (error) {
      await setStatus({ ai_review_status: 'error', ai_review_error: error instanceof Error ? error.message.slice(0, 500) : 'Review failed' });
    }
  };

  const runtime = (globalThis as { EdgeRuntime?: { waitUntil: (task: Promise<void>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(review());
    return json({ status: 'queued' }, 202);
  }
  await review();
  return json({ status: 'reviewed' });
});
