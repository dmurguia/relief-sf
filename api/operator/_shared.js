const crypto = require('crypto');

function configured() {
  return Boolean(process.env.OPERATOR_PASSWORD && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function sessionValue() {
  return crypto.createHash('sha256').update(process.env.OPERATOR_PASSWORD || '').digest('hex');
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? ['', ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function authorized(req) {
  return Boolean(process.env.OPERATOR_PASSWORD && parseCookies(req.headers.cookie).relief_operator === sessionValue());
}

function rejectUnauthorized(res) {
  res.status(401).json({ error: 'Operator password required.' });
}

async function supabase(path, options = {}) {
  const response = await fetch(`${process.env.SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(typeof body === 'object' && body?.message ? body.message : `Supabase request failed (${response.status})`);
  return { body, headers: response.headers };
}

async function signedPhotoUrl(photoPath) {
  if (!photoPath) return null;
  const { body } = await supabase(`/storage/v1/object/sign/restroom-submissions/${photoPath}`, {
    method: 'POST', body: JSON.stringify({ expiresIn: 3600 }),
  });
  return body?.signedURL ? `${process.env.SUPABASE_URL}/storage/v1${body.signedURL}` : null;
}

async function count(path) {
  const { headers } = await supabase(path, { headers: { Prefer: 'count=exact', Range: '0-0' } });
  const range = headers.get('content-range');
  return Number(range?.split('/')[1] || 0);
}

module.exports = { authorized, configured, count, rejectUnauthorized, sessionValue, signedPhotoUrl, supabase };
