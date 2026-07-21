module.exports = async function logout(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const secure = process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', `relief_operator=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
  return res.status(200).json({ ok: true });
};
