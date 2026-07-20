type Update = { restroomId: string; note: string; accessDetail?: string; cleanlinessRating?: number; photoUri?: string };
type PlaceSuggestion = { name: string; address: string; category: string; note: string; accessDetail?: string; cleanlinessRating?: number; photoUri?: string; latitude: number; longitude: number };
type JsonValue = string | number | null;
type SubmissionKind = 'place_suggestion' | 'restroom_update';
type InsertResult = { ok: boolean; omitted: string[]; id?: string };

async function insertWithOptionalColumns(url: string, key: string, table: string, payload: Record<string, JsonValue>, optionalColumns: string[]): Promise<InsertResult> {
  const workingPayload = { ...payload };
  const omitted: string[] = [];
  let response: Response | null = null;

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    response = await fetch(`${url}/rest/v1/${table}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(workingPayload),
    });
    if (response.ok) {
      const rows = await response.json().catch(() => []) as Array<{ id?: string }>;
      return { ok: true, omitted, id: rows[0]?.id };
    }

    const error = await response.json().catch(() => null) as { code?: string; message?: string } | null;
    const missingColumn = error?.code === 'PGRST204'
      ? optionalColumns.find((column) => !omitted.includes(column) && error.message?.includes(`'${column}'`))
      : undefined;
    if (!missingColumn) return { ok: false, omitted };
    delete workingPayload[missingColumn];
    omitted.push(missingColumn);
  }

  return { ok: false, omitted };
}

async function queueAutomatedReview(url: string, key: string, entityType: SubmissionKind, submissionId?: string) {
  if (!submissionId) return;
  try {
    await fetch(`${url}/functions/v1/review-submission`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType, submissionId }),
    });
  } catch {
    // The submission remains pending and can be retried by the protected operator.
  }
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
    const inserted = await insertWithOptionalColumns(url, anonKey, 'restroom_updates', { restroom_id: update.restroomId, note: update.note, access_detail: update.accessDetail || null, cleanliness_rating: update.cleanlinessRating || null, photo_path: photoPath }, ['cleanliness_rating', 'photo_path']);
    if (!inserted.ok) throw new Error('Submission failed');
    await queueAutomatedReview(url, anonKey, 'restroom_update', inserted.id);
    const omittedNote = inserted.omitted.length ? ` ${inserted.omitted.includes('photo_path') ? 'The photo' : 'The cleanliness rating'} could not be linked until the database migration is applied.` : '';
    return { remote: true, message: `It is pending moderation and will not change the map until reviewed.${omittedNote}` };
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
    const inserted = await insertWithOptionalColumns(url, key, 'place_suggestions', { name: suggestion.name, address: suggestion.address, category: suggestion.category, latitude: suggestion.latitude, longitude: suggestion.longitude, note: suggestion.note || null, access_detail: suggestion.accessDetail || null, cleanliness_rating: suggestion.cleanlinessRating || null, photo_path: photoPath }, ['cleanliness_rating', 'photo_path']);
    if (!inserted.ok) throw new Error('Submission failed');
    await queueAutomatedReview(url, key, 'place_suggestion', inserted.id);
    if (inserted.omitted.includes('photo_path')) photoNotice = ' Your place was saved, but the photo could not be linked until the database migration is applied.';
    if (inserted.omitted.includes('cleanliness_rating')) photoNotice += ' Your cleanliness rating could not be linked until the database migration is applied.';
    return { remote: true, message: `It is pending review and will appear on the map only after verification.${photoNotice}` };
  } catch { return { remote: false, message: 'Could not reach the place-review queue. It was not published.' }; }
}
