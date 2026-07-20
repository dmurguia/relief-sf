export type PlaceSuggestionResult = { id: string; name: string; subtitle: string };
export type PickedPlace = { name: string; address: string; latitude: number; longitude: number };

const sfBounds = '-122.53,37.70,-122.35,37.83';
const token = () => process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

const searchVariants = (query: string) => {
  const clean = query.trim();
  const variants = [clean];
  // Mapbox indexes this SF business under its current brand name, RH.
  if (/restoration\s+hardware/i.test(clean)) variants.push(clean.replace(/restoration\s+hardware/ig, 'RH'));
  return [...new Set(variants)];
};

/** A location confirmation image, not a photo of the business or restroom. */
export function placeMapPreview(place: PickedPlace) {
  if (!token()) return null;
  const marker = `pin-s-a+173F38(${place.longitude},${place.latitude})`;
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${marker}/${place.longitude},${place.latitude},15/640x250@2x?logo=false&access_token=${encodeURIComponent(token()!)}`;
}

export async function suggestBusinesses(query: string, sessionToken: string): Promise<PlaceSuggestionResult[]> {
  if (!token() || query.trim().length < 2) return [];
  const responses = await Promise.all(searchVariants(query).map(async (variant) => {
    const params = new URLSearchParams({ q: variant, access_token: token()!, session_token: sessionToken, bbox: sfBounds, proximity: '-122.4194,37.7749', country: 'US', limit: '6' });
    const response = await fetch(`https://api.mapbox.com/search/searchbox/v1/suggest?${params}`);
    if (!response.ok) throw new Error('Place search unavailable');
    const body = await response.json();
    return (body.suggestions ?? []).filter((item: any) => item.feature_type === 'poi' || item.feature_type === 'address').map((item: any) => ({ id: item.mapbox_id, name: item.name_preferred || item.name, subtitle: item.full_address || item.place_formatted || 'San Francisco' }));
  }));
  return responses.flat().filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index).slice(0, 6);
}

export async function retrieveBusiness(id: string, sessionToken: string): Promise<PickedPlace> {
  if (!token()) throw new Error('Mapbox token missing');
  const params = new URLSearchParams({ access_token: token()!, session_token: sessionToken });
  const response = await fetch(`https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(id)}?${params}`);
  if (!response.ok) throw new Error('Place lookup unavailable');
  const feature = (await response.json()).features?.[0];
  if (!feature?.geometry?.coordinates) throw new Error('Place not found');
  return { name: feature.properties?.name_preferred || feature.properties?.name || feature.text || 'Suggested place', address: feature.properties?.full_address || feature.properties?.place_formatted || feature.properties?.address || 'San Francisco', longitude: feature.geometry.coordinates[0], latitude: feature.geometry.coordinates[1] };
}
