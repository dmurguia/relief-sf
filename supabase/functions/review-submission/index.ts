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
  restroom_id?: string;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

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
  const rowResponse = await fetch(`${supabaseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(submissionId)}&select=*`, { headers });
  const [submission] = await rowResponse.json().catch(() => []) as Submission[];
  if (!submission) return json({ error: 'Submission not found' }, 404);
  if (submission.ai_review_status === 'reviewed' || submission.ai_review_status === 'reviewing') return json({ status: submission.ai_review_status });

  const setStatus = async (body: Record<string, unknown>) => fetch(`${supabaseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(submissionId)}`, {
    method: 'PATCH', headers, body: JSON.stringify(body),
  });

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
      const prompt = `You are the evidence reviewer for Relief, a restroom finder. Review one ${entityType.replace('_', ' ')}. Return ONLY valid JSON: {"decision":"eligible_for_human_publish|needs_human_review|reject","confidence":0.0,"is_restroom_photo":true,"safe_to_publish":true,"supported_facts":["short strings"],"proposed_tags":["accessible|all_gender|clean|spacious|well_lit|stall|sink|unknown"],"description":"max 240 characters","concerns":["short strings"],"reason":"max 180 characters"}. Only treat facts as supported when they are visible in the photo or explicitly stated by the contributor. Never infer hours, price, door codes, business policy, accessibility compliance, or whether a venue has a restroom from its category. If there is no photo, do not claim visual evidence. Reject photos with people, readable codes, personal information, or a non-restroom subject. This is an AI recommendation, never a final publication decision. Identity: ${JSON.stringify(identity)}. Contributor note: ${JSON.stringify(submission.note ?? '')}. Access detail: ${JSON.stringify(submission.access_detail ?? '')}. Cleanliness rating: ${JSON.stringify(submission.cleanliness_rating ?? null)}.`;
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
      const parsed = JSON.parse(outputText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
      await setStatus({ ai_review: parsed, ai_review_status: 'reviewed', ai_reviewed_at: new Date().toISOString(), ai_review_error: null });
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
