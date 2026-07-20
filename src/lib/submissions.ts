type Update = { restroomId: string; note: string; accessDetail?: string; cleanlinessRating?: number; photoUri?: string };
type PlaceSuggestion = { name: string; address: string; category: string; note: string; accessDetail?: string; cleanlinessRating?: number; photoUri?: string; latitude: number; longitude: number };
type SubmissionKind = 'place_suggestion' | 'restroom_update';

async function submitContribution(url: string, key: string, entityType: SubmissionKind, payload: Record<string, unknown>) {
  const response = await fetch(`${url}/functions/v1/submit-contribution`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ entityType, payload }),
  });
  return response.ok;
}

const localUpdates: Update[] = [];

export async function submitRestroomUpdate(update: Update): Promise<{ remote: boolean; message: string }> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    localUpdates.push(update);
    return { remote: false, message: 'Connect Supabase to send anonymous updates to the moderation queue.' };
  }
  try {
    let photoPath: string | null = null;
    if (update.photoUri) {
      const image = await fetch(update.photoUri);
      const imageBlob = await image.blob();
      photoPath = `pending/${update.restroomId}/${Date.now()}.jpg`;
      const photoUpload = await fetch(`${url}/storage/v1/object/restroom-submissions/${photoPath}`, {
        method: 'POST',
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': imageBlob.type || 'image/jpeg', 'x-upsert': 'false' },
        body: imageBlob,
      });
      if (!photoUpload.ok) throw new Error('Photo upload failed');
    }
    const submitted = await submitContribution(url, anonKey, 'restroom_update', { restroom_id: update.restroomId, note: update.note || 'Contributor submitted a restroom-only photo for review.', access_detail: update.accessDetail || null, cleanliness_rating: update.cleanlinessRating || null, photo_path: photoPath });
    if (!submitted) throw new Error('Submission failed');
    return { remote: true, message: 'It is pending moderation and will not change the map until reviewed.' };
  } catch {
    return { remote: false, message: 'Could not reach the update queue. Your note was not published.' };
  }
}

export async function submitPlaceSuggestion(suggestion: PlaceSuggestion): Promise<{ remote: boolean; message: string }> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { remote: false, message: 'Connect Supabase to send this place for review.' };
  try {
    let photoPath: string | null = null;
    let photoNotice = '';
    if (suggestion.photoUri) {
      try {
        const image = await fetch(suggestion.photoUri);
        const imageBlob = await image.blob();
        photoPath = `pending/place-suggestion/${Date.now()}.jpg`;
        const photoUpload = await fetch(`${url}/storage/v1/object/restroom-submissions/${photoPath}`, {
          method: 'POST',
          headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': imageBlob.type || 'image/jpeg', 'x-upsert': 'false' },
          body: imageBlob,
        });
        if (!photoUpload.ok) throw new Error('Photo upload failed');
      } catch {
        // A photo is helpful but optional. Never discard a useful place lead
        // because a device format or upload connection rejected its image.
        photoPath = null;
        photoNotice = ' Your place was saved, but the photo could not be attached—please try a JPEG or PNG next time.';
      }
    }
    const submitted = await submitContribution(url, key, 'place_suggestion', { name: suggestion.name, address: suggestion.address, category: suggestion.category, latitude: suggestion.latitude, longitude: suggestion.longitude, note: suggestion.note || null, access_detail: suggestion.accessDetail || null, cleanliness_rating: suggestion.cleanlinessRating || null, photo_path: photoPath });
    if (!submitted) throw new Error('Submission failed');
    return { remote: true, message: `It is pending review and will appear on the map only after verification.${photoNotice}` };
  } catch { return { remote: false, message: 'Could not reach the place-review queue. It was not published.' }; }
}
