# Relief — San Francisco restroom finder

Relief helps someone find a usable restroom before it becomes an emergency. It deliberately separates **city-verified restrooms** from **unverified venue leads**, then uses GPT-5.6 to help a human reviewer assess contributor-owned restroom photos and evidence.

## What judges can try

- Browser demo: deploy the `dist/` build to Vercel (instructions below)
- iOS demo: `npm run ios`
- Main flow: search the map, tap **I'M FEELING LUCKY**, inspect a restroom, then submit an anonymous update or suggest an existing business through Mapbox search

There is no account requirement. Public submissions always remain `pending` until an operator reviews them.

## Trust model

| Layer | What it means | Visible on the map? |
| --- | --- | --- |
| City-verified | City of San Francisco public restroom asset from DataSF | Yes |
| Community-verified | A place approved after a human reviews supported evidence | Yes |
| Candidate venue | An open-data/official-source lead that may have a restroom | No |
| Anonymous update | Community report, rating, or contributor-owned restroom photo | No, until reviewed |

Relief does not scrape or republish Yelp/Google photos or review text. Mapbox is used only for live business discovery in the suggestion form; it is not a bulk seed source. Candidate venues must retain provenance and stay out of the public map until verified.

## Local setup

```bash
npm install
cp .env.example .env
npm run ios
# or
npm run web
```

Set these public client variables in `.env`:

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
EXPO_PUBLIC_MAPBOX_TOKEN=pk.YOUR_PUBLIC_MAPBOX_TOKEN
```

The Mapbox token is a public client token. Restrict it to `localhost` during development and the deployed Vercel URL afterward. Never add a Supabase service-role key or OpenAI API key to an `EXPO_PUBLIC_` variable.

## Supabase: one-time setup

In the Supabase SQL Editor, run these files in order:

1. [`supabase/schema.sql`](./supabase/schema.sql)
2. [`supabase/add-place-suggestions.sql`](./supabase/add-place-suggestions.sql)
3. [`supabase/add-cleanliness-ratings.sql`](./supabase/add-cleanliness-ratings.sql)
4. [`supabase/add-place-suggestion-photos.sql`](./supabase/add-place-suggestion-photos.sql)
5. [`supabase/add-trust-pipeline.sql`](./supabase/add-trust-pipeline.sql)
6. [`supabase/add-automated-review.sql`](./supabase/add-automated-review.sql)
7. [`supabase/fix-anonymous-submission-rls.sql`](./supabase/fix-anonymous-submission-rls.sql)
8. [`supabase/generated/city-public-restrooms.sql`](./supabase/generated/city-public-restrooms.sql)

The final generated file contains 214 current DataSF city restroom records. Regenerate it before a release with:

```bash
node scripts/build-city-restroom-seed.mjs
```

The app reads `approved` Supabase restrooms at launch and uses the small local set only if the database is unavailable or empty.

## Candidate-venue research queue

Run the candidate generator after the City seed is live:

```bash
node scripts/build-osm-candidate-seed.mjs
```

It creates small `supabase/generated/osm-venue-candidates-*.sql` batches: a private `venue_candidates` queue of open-data venues, not restroom claims. Execute every batch in Supabase only after `add-trust-pipeline.sql`. Retain the visible attribution `© OpenStreetMap contributors` with a link to [its copyright page](https://www.openstreetmap.org/copyright). [`scripts/build-osm-candidate-query.md`](./scripts/build-osm-candidate-query.md) documents the guardrails.

### Where the 3,444 candidates came from

The candidate generator sends one reproducible Overpass query over the San Francisco bounding box. It collects named OpenStreetMap venues tagged as cafes, restaurants, fast-food locations, libraries, community centres, marketplaces, toilets, supermarkets, or department stores; it deduplicates by normalized name and approximate coordinates. Every candidate retains its OpenStreetMap object URL, source name, retrieval time, and ODbL 1.0 license. The count is **not** a claim that 3,444 restrooms exist—these are private venue leads that may be researched, rejected, or escalated.

## GPT-5.6 photo review

Every new place suggestion or restroom update automatically queues [`supabase/functions/review-submission/index.ts`](./supabase/functions/review-submission/index.ts) after Supabase confirms its insert. The server-side function reads the private contributor photo when present and stores GPT-5.6's structured recommendation, confidence, supported facts, proposed tags, and concerns. It explicitly rejects people, visible door codes, personal data, and non-restroom photos. A human still decides whether to publish.

The novel use of GPT-5.6 is **evidence-constrained review, not location generation**: it converts a private, contributor-owned photo plus the submitted note into a structured moderation proposal; it is forbidden from inferring hours, pricing, door codes, or accessibility compliance. The operator can then accept or reject discrete proposed facts instead of reading every image from scratch. Candidate venues are deliberately kept separate: GPT-5.6 has not been used to declare the OpenStreetMap queue to be verified restrooms.

### Coverage expansion jobs

Run [`supabase/add-exploration-jobs.sql`](./supabase/add-exploration-jobs.sql) once. The in-app Settings → Coverage Lab shows an operator-facing scope brief, but cannot launch work from the public client. Create a protected job locally only after setting a service-role key:

```bash
node scripts/queue-exploration-job.mjs neighborhood "SoMa"
node scripts/queue-exploration-job.mjs city "San Francisco"
```

Job runners may use only city/open datasets and official business sources, must retain evidence and licensing information, and must write discoveries as private `venue_candidates`. A human approves any public restroom record.

This abstraction can queue a new city such as New York for private candidate review, but the public Relief map remains SF-only until that city has an approved, human-reviewed inventory. Do not describe a queued city as verified coverage.

Deploy it after installing and logging in to the Supabase CLI:

```bash
supabase secrets set OPENAI_API_KEY=... RELIEF_REVIEW_TOKEN=...
supabase functions deploy enrich-restroom-photo
supabase functions deploy review-submission
supabase functions deploy submit-contribution
```

`enrich-restroom-photo` deliberately disables Supabase's default JWT check because it is invoked from the private operator script, then enforces its own `RELIEF_REVIEW_TOKEN`. Never expose that token to the app or Vercel.

Keep the following values only in your local operator environment—not in Vercel or the app:

```env
SUPABASE_SERVICE_ROLE_KEY=...
RELIEF_REVIEW_TOKEN=...
```

Review pending records:

```bash
node scripts/moderate.mjs pending
node scripts/moderate.mjs review-photo UPDATE_ID
node scripts/moderate.mjs approve-update UPDATE_ID
```

## Vercel judge URL

The repository includes [`vercel.json`](./vercel.json). In Vercel, import the GitHub repository as framework **Other**, then set these variables for both Preview and Production:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_MAPBOX_TOKEN`

Vercel runs `npm run build` and serves `dist/`. After the first deployment, add the Vercel URL to the Mapbox token's allowed URLs and redeploy.

## Build Week submission checklist

- [ ] Public Vercel demo URL works without login
- [ ] Repository is public, or shared with `testing@devpost.com` and `build-week-event@openai.com`
- [ ] README includes setup, sample data, and this trust model
- [ ] GPT-5.6 photo review has been deployed and demonstrated on one safe contributor photo
- [ ] <3-minute public YouTube video shows: immediate-restroom flow, Mapbox business suggestion, city-verified data, pending moderation, and GPT-5.6 review
- [ ] Video voiceover explains the concrete Codex workflow and GPT-5.6 review role
- [ ] Submission includes the primary Codex `/feedback` Session ID
