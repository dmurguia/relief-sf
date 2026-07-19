import { mkdir, writeFile } from 'node:fs/promises';

const bbox = '37.70,-122.53,37.83,-122.35';
const query = `[out:json][timeout:120];\n(\n  nwr["amenity"~"^(cafe|restaurant|fast_food|library|community_centre|marketplace|toilets)$"](${bbox});\n  nwr["shop"~"^(supermarket|department_store)$"](${bbox});\n);\nout center tags;`;
const response = await fetch(`https://overpass-api.de/api/interpreter?${new URLSearchParams({ data: query })}`, { headers: { 'User-Agent': 'Relief-SF-hackathon-candidate-generator/1.0' } });
if (!response.ok) throw new Error(`Overpass request failed (${response.status})`);
const { elements = [] } = await response.json();
const sql = (value) => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const coordinates = (item) => item.type === 'node' ? [item.lon, item.lat] : [item.center?.lon, item.center?.lat];
const address = (tags) => [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ') || tags['addr:full'] || null;
const kind = (tags) => tags.amenity || tags.shop || 'venue';

const seen = new Set();
const candidates = elements.flatMap((item) => {
  const [longitude, latitude] = coordinates(item);
  const tags = item.tags ?? {};
  const name = tags.name;
  if (!name || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return [];
  const key = `${name.toLowerCase()}|${Math.round(latitude * 10000)}|${Math.round(longitude * 10000)}`;
  if (seen.has(key)) return [];
  seen.add(key);
  return [{ id: `osm-${item.type}-${item.id}`, name, address: address(tags), latitude, longitude, venueType: kind(tags), sourceUrl: `https://www.openstreetmap.org/${item.type}/${item.id}` }];
});

const rowSql = (item) => `(${sql(item.id)}, ${sql(item.name)}, ${sql(item.address)}, ${item.latitude}, ${item.longitude}, ${sql(item.venueType)}, 'OpenStreetMap', ${sql(item.sourceUrl)}, 'ODbL 1.0', now(), ${sql(`OpenStreetMap ${item.venueType} tag. This is an unverified venue lead, not a restroom claim.`)}, 'pending'::review_status)`;
const header = `-- Generated ${new Date().toISOString()} from OpenStreetMap via Overpass.\n-- ${candidates.length} pending venue leads. Keep this file attributed under ODbL 1.0.\n-- Do not publish these on the Relief map without human verification.\n`;
const upsert = `\non conflict (id) do update set name = excluded.name, address = excluded.address, latitude = excluded.latitude, longitude = excluded.longitude, venue_type = excluded.venue_type, source_name = excluded.source_name, source_url = excluded.source_url, source_license = excluded.source_license, source_retrieved_at = excluded.source_retrieved_at, evidence_note = excluded.evidence_note;\n`;
await mkdir('supabase/generated', { recursive: true });
const batches = Array.from({ length: Math.ceil(candidates.length / 500) }, (_, index) => candidates.slice(index * 500, (index + 1) * 500));
for (const [index, batch] of batches.entries()) {
  const output = `${header}-- Batch ${index + 1} of ${batches.length}\ninsert into venue_candidates (id, name, address, latitude, longitude, venue_type, source_name, source_url, source_license, source_retrieved_at, evidence_note, status) values\n${batch.map(rowSql).join(',\n')}${upsert}`;
  await writeFile(`supabase/generated/osm-venue-candidates-${String(index + 1).padStart(2, '0')}.sql`, output);
}
console.log(`Generated ${candidates.length} pending OSM venue candidates in ${batches.length} SQL batches at supabase/generated/`);
