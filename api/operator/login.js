const { configured, sessionValue } = require('./_shared');

module.exports = async function login(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!configured()) return res.status(503).json({ error: 'Operator API is not configured. Add the Vercel operator secrets.' });
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (password !== process.env.OPERATOR_PASSWORD) return res.status(401).json({ error: 'That password is not correct.' });
  const secure = process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', `relief_operator=${sessionValue()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure}`);
  return res.status(200).json({ ok: true });
};
