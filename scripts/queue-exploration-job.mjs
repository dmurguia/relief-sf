// Private operator helper. Never put SUPABASE_SERVICE_ROLE_KEY in the app or Vercel.
const [scopeType, ...scopeParts] = process.argv.slice(2);
const scopeName = scopeParts.join(' ').trim();
const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!['city', 'neighborhood'].includes(scopeType) || !scopeName) {
  throw new Error('Usage: node scripts/queue-exploration-job.mjs city "San Francisco" | neighborhood "SoMa"');
}
if (!url || !serviceKey) throw new Error('Set SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY locally.');

const response = await fetch(`${url}/rest/v1/exploration_jobs`, {
  method: 'POST',
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ scope_type: scopeType, scope_name: scopeName, notes: 'Collect permitted evidence only; never auto-publish.' }),
});
const body = await response.json().catch(() => null);
if (!response.ok) throw new Error(body?.message ?? body?.error ?? `Could not queue exploration job (${response.status})`);
console.log(JSON.stringify(body, null, 2));
