// Public submission gateway for Relief's anonymous contribution flow.
// The browser never writes review tables directly; this function validates the
// request, writes a pending record with server credentials, and queues GPT review.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Content-Type': 'application/json',
};

type EntityType = 'place_suggestion' | 'restroom_update';
type Body = {
  entityType?: EntityType;
  payload?: Record<string, unknown>;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const isText = (value: unknown, min: number, max: number) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
const optionalText = (value: unknown, max: number) => value == null || (typeof value === 'string' && value.trim().length <= max);
const validPhotoPath = (value: unknown) => value == null || (typeof value === 'string' && value.startsWith('pending/') && !value.includes('..'));
const validRating = (value: unknown) => value == null || (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const { entityType, payload } = await request.json().catch(() => ({})) as Body;
  if ((entityType !== 'place_suggestion' && entityType !== 'restroom_update') || !payload) return json({ error: 'A contribution type and payload are required' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Submission service is not configured' }, 503);

  const category = payload.category;
  const sharedValid = optionalText(payload.access_detail, 280) && validRating(payload.cleanliness_rating) && validPhotoPath(payload.photo_path);
  const valid = entityType === 'place_suggestion'
    ? isText(payload.name, 2, 160) && isText(payload.address, 5, 280) && ['Public', 'Park', 'Restaurant', 'Grocery', 'Coffee'].includes(String(category)) && Number.isFinite(Number(payload.latitude)) && Number.isFinite(Number(payload.longitude)) && Number(payload.latitude) >= 37.6 && Number(payload.latitude) <= 37.9 && Number(payload.longitude) >= -122.6 && Number(payload.longitude) <= -122.3 && optionalText(payload.note, 1000) && sharedValid
    : isText(payload.restroom_id, 1, 200) && isText(payload.note, 3, 1000) && sharedValid;
  if (!valid) return json({ error: 'Contribution contains invalid or incomplete fields' }, 400);

  const table = entityType === 'place_suggestion' ? 'place_suggestions' : 'restroom_updates';
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const submission = entityType === 'place_suggestion'
    ? {
      name: String(payload.name).trim(), address: String(payload.address).trim(), category: String(payload.category),
      latitude: Number(payload.latitude), longitude: Number(payload.longitude), note: typeof payload.note === 'string' ? payload.note.trim() || null : null,
      access_detail: typeof payload.access_detail === 'string' ? payload.access_detail.trim() || null : null,
      cleanliness_rating: payload.cleanliness_rating ?? null, photo_path: payload.photo_path ?? null, status: 'pending',
    }
    : {
      restroom_id: String(payload.restroom_id), note: String(payload.note).trim(),
      access_detail: typeof payload.access_detail === 'string' ? payload.access_detail.trim() || null : null,
      cleanliness_rating: payload.cleanliness_rating ?? null, photo_path: payload.photo_path ?? null, status: 'pending',
    };
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}`, { method: 'POST', headers, body: JSON.stringify(submission) });
  const data = await response.json().catch(() => null) as Array<{ id?: string }> | { message?: string } | null;
  if (!response.ok) return json({ error: data && !Array.isArray(data) ? data.message ?? 'Unable to save contribution' : 'Unable to save contribution' }, 502);

  const id = Array.isArray(data) ? data[0]?.id : undefined;
  if (!id) return json({ error: 'Contribution saved without an identifier' }, 502);

  // The review function returns quickly with a queued acknowledgement and runs
  // the model privately. A review failure never discards a contributor record.
  await fetch(`${supabaseUrl}/functions/v1/review-submission`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ entityType, submissionId: id }),
  }).catch(() => undefined);

  return json({ id, status: 'queued' }, 201);
});
