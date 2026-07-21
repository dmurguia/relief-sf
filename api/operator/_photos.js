const extensionFor = (sourcePath, contentType) => {
  const match = String(sourcePath || '').toLowerCase().match(/\.(jpg|jpeg|png|webp)$/);
  if (match) return match[1] === 'jpeg' ? 'jpg' : match[1];
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'jpg';
};

async function promoteApprovedPhoto(photoPath, restroomId) {
  if (!photoPath) return null;
  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const auth = { apikey: key, Authorization: `Bearer ${key}` };
  const signedResponse = await fetch(`${baseUrl}/storage/v1/object/sign/restroom-submissions/${photoPath}`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 120 }),
  });
  const signed = await signedResponse.json().catch(() => null);
  if (!signedResponse.ok || !signed?.signedURL) throw new Error('Could not read the approved private photo.');
  const source = await fetch(`${baseUrl}/storage/v1${signed.signedURL}`);
  if (!source.ok) throw new Error('Could not download the approved private photo.');
  const contentType = source.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new Error('Approved photo has an unsupported file type.');
  const publicPath = `verified/${restroomId}.${extensionFor(photoPath, contentType)}`;
  const uploaded = await fetch(`${baseUrl}/storage/v1/object/restroom-photos/${publicPath}`, {
    method: 'POST', headers: { ...auth, 'Content-Type': contentType, 'x-upsert': 'true' }, body: await source.arrayBuffer(),
  });
  if (!uploaded.ok) throw new Error('Could not publish the approved restroom photo.');
  return publicPath;
}

module.exports = { promoteApprovedPhoto };
