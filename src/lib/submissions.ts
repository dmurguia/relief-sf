type Update = { restroomId: string; note: string; accessDetail?: string; cleanlinessRating?: number; photoUri?: string };
type PlaceSuggestion = { name: string; address: string; category: string; note: string; accessDetail?: string; cleanlinessRating?: number; latitude: number; longitude: number };

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
    const response = await fetch(`${url}/rest/v1/restroom_updates`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ restroom_id: update.restroomId, note: update.note, access_detail: update.accessDetail || null, cleanliness_rating: update.cleanlinessRating || null, photo_path: photoPath }),
    });
    if (!response.ok) throw new Error('Submission failed');
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
    const response = await fetch(`${url}/rest/v1/place_suggestions`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ name: suggestion.name, address: suggestion.address, category: suggestion.category, latitude: suggestion.latitude, longitude: suggestion.longitude, note: suggestion.note || null, access_detail: suggestion.accessDetail || null, cleanliness_rating: suggestion.cleanlinessRating || null }),
    });
    if (!response.ok) throw new Error('Submission failed');
    return { remote: true, message: 'It is pending review and will appear on the map only after verification.' };
  } catch { return { remote: false, message: 'Could not reach the place-review queue. It was not published.' }; }
}
