import { Restroom, restrooms as localFixtures } from '../data/restrooms';

type RestroomRow = {
  id: string; name: string; address: string; neighborhood: string; category: Restroom['category']; latitude: number; longitude: number;
  hours: string; access: string; tags: string[]; description: string; source_tier?: Restroom['sourceTier']; public_photo_path?: string | null;
};

const colors: Record<Restroom['category'], string> = { Public: '#C95B34', Park: '#436D48', Restaurant: '#9B5B47', Grocery: '#C28B2C', Coffee: '#5C718F' };
const fallbackCommercial = localFixtures.filter((item) => !['Public', 'Park'].includes(item.category));

const toRestroom = (row: RestroomRow): Restroom => ({
  ...row,
  category: row.category,
  tags: row.tags ?? [],
  color: colors[row.category],
  photoStatus: row.public_photo_path ? 'verified' : 'needed',
  photoUrl: row.public_photo_path ? `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/restroom-photos/${encodeURIComponent(row.public_photo_path).replace(/%2F/g, '/')}` : undefined,
  opensAt: 0,
  closesAt: 0,
  hoursStatus: row.hours === 'Check posted hours' ? 'confirm' : 'known',
  sourceTier: row.source_tier ?? 'community_verified',
});

export const fallbackDirectory = localFixtures;

export async function loadApprovedRestrooms(): Promise<Restroom[]> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return fallbackDirectory;
  const authHeaders = { apikey: key, Authorization: `Bearer ${key}` };
  const fields = 'id,name,address,neighborhood,category,latitude,longitude,hours,access,tags,description,source_tier';
  let response = await fetch(`${url}/rest/v1/restrooms?select=${fields},public_photo_path&verification_status=eq.approved&order=name.asc`, { headers: authHeaders });
  // Keep the public map usable during the short Vercel/SQL migration window.
  if (!response.ok && response.status === 400) response = await fetch(`${url}/rest/v1/restrooms?select=${fields}&verification_status=eq.approved&order=name.asc`, { headers: authHeaders });
  if (!response.ok) throw new Error('Directory request failed');
  const approved = (await response.json() as RestroomRow[]).map(toRestroom);
  if (!approved.length) return fallbackDirectory;
  return [...approved, ...fallbackCommercial];
}
