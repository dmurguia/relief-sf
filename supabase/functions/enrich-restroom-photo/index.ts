// Operator-only function: never call from the public mobile client.
// Required secrets: OPENAI_API_KEY and RELIEF_REVIEW_TOKEN.
const cors = { 'Content-Type': 'application/json' };

type Update = { id: string; note: string; access_detail: string | null; photo_path: string | null };

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: cors });
  if (request.headers.get('x-relief-review-token') !== Deno.env.get('RELIEF_REVIEW_TOKEN')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors });
  }

  const { updateId } = await request.json();
  if (!updateId || typeof updateId !== 'string') return new Response(JSON.stringify({ error: 'updateId is required' }), { status: 400, headers: cors });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const updateResponse = await fetch(`${supabaseUrl}/rest/v1/restroom_updates?id=eq.${encodeURIComponent(updateId)}&select=id,note,access_detail,photo_path`, { headers: supabaseHeaders });
  const [update] = await updateResponse.json() as Update[];
  if (!update) return new Response(JSON.stringify({ error: 'Update not found' }), { status: 404, headers: cors });
  if (!update.photo_path) return new Response(JSON.stringify({ error: 'This update has no photo' }), { status: 400, headers: cors });

  const signed = await fetch(`${supabaseUrl}/storage/v1/object/sign/restroom-submissions/${update.photo_path}`, {
    method: 'POST', headers: supabaseHeaders, body: JSON.stringify({ expiresIn: 120 }),
  });
  const signedData = await signed.json();
  if (!signed.ok || !signedData.signedURL) return new Response(JSON.stringify({ error: 'Could not read private photo' }), { status: 502, headers: cors });

  const imageUrl = `${supabaseUrl}/storage/v1${signedData.signedURL}`;
  const prompt = `You review a single contributor-submitted photo for a restroom finder. Return ONLY valid JSON with this exact shape: {"is_restroom":boolean,"safe_to_publish":boolean,"description":"max 240 characters","tags":["accessible|unisex|clean|spacious|well_lit|stall|sink|unknown"],"concerns":["short strings"]}. Use only visually grounded facts. Never infer opening hours, safety, accessibility compliance, price, purchase requirements, or door codes. Set safe_to_publish false if people, a legible door/access code, personal data, or non-restroom subject is visible. Contributor note: ${JSON.stringify(update.note)}. Access note: ${JSON.stringify(update.access_detail ?? '')}`;
  const aiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.6', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: imageUrl }] }] }),
  });
  const aiData = await aiResponse.json();
  const output = aiData.output_text;
  if (!aiResponse.ok || typeof output !== 'string') return new Response(JSON.stringify({ error: 'OpenAI review failed', detail: aiData.error?.message }), { status: 502, headers: cors });

  let review: unknown;
  try { review = JSON.parse(output); } catch { return new Response(JSON.stringify({ error: 'Model returned non-JSON', output }), { status: 502, headers: cors }); }
  const saved = await fetch(`${supabaseUrl}/rest/v1/restroom_updates?id=eq.${encodeURIComponent(updateId)}`, {
    method: 'PATCH', headers: { ...supabaseHeaders, Prefer: 'return=representation' }, body: JSON.stringify({ ai_review: review }),
  });
  if (!saved.ok) return new Response(JSON.stringify({ error: 'Could not store review' }), { status: 502, headers: cors });
  return new Response(JSON.stringify({ review }), { headers: cors });
});
