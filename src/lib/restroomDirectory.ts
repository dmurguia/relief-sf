import { Restroom, restrooms as localFixtures } from '../data/restrooms';

type RestroomRow = {
  id: string; name: string; address: string; neighborhood: string; category: Restroom['category']; latitude: number; longitude: number;
  hours: string; access: string; tags: string[]; description: string; source_tier?: Restroom['sourceTier'];
};

const colors: Record<Restroom['category'], string> = { Public: '#C95B34', Park: '#436D48', Restaurant: '#9B5B47', Grocery: '#C28B2C', Coffee: '#5C718F' };
const fallbackCommercial = localFixtures.filter((item) => !['Public', 'Park'].includes(item.category));

const toRestroom = (row: RestroomRow): Restroom => ({
  ...row,
  category: row.category,
  tags: row.tags ?? [],
  color: colors[row.category],
  photoStatus: 'needed',
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
  const response = await fetch(`${url}/rest/v1/restrooms?select=id,name,address,neighborhood,category,latitude,longitude,hours,access,tags,description,source_tier&verification_status=eq.approved&order=name.asc`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!response.ok) throw new Error('Directory request failed');
  const approved = (await response.json() as RestroomRow[]).map(toRestroom);
  if (!approved.length) return fallbackDirectory;
  return [...approved, ...fallbackCommercial];
}
