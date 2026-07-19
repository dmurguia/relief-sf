import { mkdir, writeFile } from 'node:fs/promises';

const endpoint = "https://data.sfgov.org/resource/hvr9-9r5z.json?$select=name,uid,resource_type,latitude,longitude,address,access,public_access_days,notes,source,analysis_neighborhood,data_as_of&$where=resource_type='restroom'&$limit=500";
const sourceUrl = 'https://data.sfgov.org/City-Infrastructure/San-Francisco-Public-Bathrooms-and-Water-Fountains/hvr9-9r5z';
const sql = (value) => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const textArray = (values) => `array[${values.map(sql).join(', ')}]::text[]`;

const response = await fetch(endpoint);
if (!response.ok) throw new Error(`DataSF request failed (${response.status})`);
const rows = await response.json();
const valid = rows.filter((row) => row.uid && Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude)));

const statements = valid.map((row) => {
  const category = ['recpark', 'port'].includes(String(row.source).toLowerCase()) ? 'Park' : 'Public';
  const tags = ['public', 'city-managed', String(row.source || 'city').toLowerCase()];
  return `(${sql(`datasf-${row.uid}`)}, ${sql(row.name || 'San Francisco public restroom')}, ${sql(row.address || 'San Francisco')}, ${sql(row.analysis_neighborhood || 'San Francisco')}, ${sql(category)}::restroom_category, ${Number(row.latitude)}, ${Number(row.longitude)}, 'Check posted hours', 'Free · city-managed', ${textArray(tags)}, 'City-recorded public restroom. Hours and access conditions may change; check posted signage when you arrive.', ${sql(sourceUrl)}, 'DataSF public bathrooms and water fountains', 'official_city', ${sql(row.data_as_of || null)}::timestamptz, 'approved'::review_status)`;
});

const output = `-- Generated ${new Date().toISOString()} from ${sourceUrl}\n-- ${valid.length} city-recorded restroom assets. Re-run this script to refresh before importing.\ninsert into restrooms (id, name, address, neighborhood, category, latitude, longitude, hours, access, tags, description, source_url, source_name, source_tier, source_updated_at, verification_status) values\n${statements.join(',\n')}\non conflict (id) do update set\n  name = excluded.name, address = excluded.address, neighborhood = excluded.neighborhood, category = excluded.category, latitude = excluded.latitude, longitude = excluded.longitude, hours = excluded.hours, access = excluded.access, tags = excluded.tags, description = excluded.description, source_url = excluded.source_url, source_name = excluded.source_name, source_tier = excluded.source_tier, source_updated_at = excluded.source_updated_at, verification_status = excluded.verification_status, updated_at = now();\n`;

await mkdir('supabase/generated', { recursive: true });
await writeFile('supabase/generated/city-public-restrooms.sql', output);
console.log(`Generated ${valid.length} approved city restroom records at supabase/generated/city-public-restrooms.sql`);
