# Relief — San Francisco restroom finder

Relief helps someone find a usable restroom before it becomes an emergency. I used GPT-5.6 to seed, contribute, and scale this footprint across SF in a matter of days. The idea is this becomes useful for the community over time as more restrooms are contributed and added. As a former PM I kept my contributions focused on high-level product flow and the user-flow outcomes I wanted for the user (consumer, contributor, and operator). GPT helped me be the researcher (finding publicly available restroom data for SF), the designer (frist pass on UI), the architect (where to host, how to bring in map data), and staff engineer (what guardrails to put in place on submissions, how to categorize image classification, what should be operator reviweed vs. scaled with a GPT 5.6 pipepline), and finally the SRE (to help work through any bugs or errors). 

## What judges can try

- Easiest would be to simply bring up SF Relief on a browswer (mobile or desktop). Purposefully did this to make it easy to consume. Intentionally left out user-auth but gated contributions to be operator/admin reviewed.
  -https://relief-sf.vercel.app/ (consumer + contributer view)
  -https://relief-sf.vercel.app/operator (operator view)
- Main flow: search the map, tap **I'M FEELING LUCKY**, inspect a restroom, then submit an anonymous update or suggest an existing business through Mapbox search
- Operator Flow: type in /operator on url, insert pw (openaihackathon), look at different review queue tabs and approve or reject. 

There is no account requirement. Public submissions remain `pending` by default; an operator can explicitly enable a bounded GPT autopilot for high-confidence, safe, photo-backed submissions.

## Trust model

| Layer | What it means | Visible on the map? |
| --- | --- | --- |
| City-verified | City of San Francisco public restroom asset from DataSF | Yes |
| Community-verified | A place approved after human review or a strict GPT autopilot policy | Yes |
| Candidate venue | An open-data/official-source lead that may have a restroom | No |
| Anonymous update | Community report, rating, or contributor-owned restroom photo | No, until reviewed |

Relief does not scrape or republish Yelp/Google photos or review text. Mapbox is used only for live business discovery in the suggestion form; it is not a bulk seed source. Candidate venues stay out of the public map until verified either through GPT confidence interval or human review. 

## Local setup (not required) since Vercel app is better. 



### Where the 3,444 candidates came from

The candidate generator sends one reproducible Overpass query over the San Francisco bounding box. It collects named OpenStreetMap venues tagged as cafes, restaurants, fast-food locations, libraries, community centres, marketplaces, toilets, supermarkets, or department stores; it deduplicates by normalized name and approximate coordinates. Every candidate retains its OpenStreetMap object URL, source name, retrieval time, and ODbL 1.0 license. The count is **not** a claim that 3,444 restrooms exist—these are private venue leads that may be researched, rejected, or escalated.

## GPT-5.6 photo review

Every new place suggestion or restroom update automatically queues [`supabase/functions/review-submission/index.ts`](./supabase/functions/review-submission/index.ts) after Supabase confirms its insert. The server-side function reads the private contributor photo when present and stores GPT-5.6's structured recommendation, confidence, supported facts, proposed tags, and concerns. It explicitly rejects people, visible door codes, personal data, and non-restroom photos.

The novel use of GPT-5.6 is **evidence-constrained review, not location generation**: it converts a private, contributor-owned photo plus the submitted note into a structured moderation proposal; it is forbidden from inferring hours, pricing, door codes, or accessibility compliance. The operator can then accept or reject discrete proposed facts instead of reading every image from scratch. Candidate venues are deliberately kept separate: GPT-5.6 has not been used to declare the OpenStreetMap queue to be verified restrooms.

### Bounded GPT autopilot

Operator Review includes a single autopilot control, **off by default**, with a selectable confidence threshold of 90%, 92%, or 95%. It can auto-publish only a contributor submission with a contributor-owned restroom photo, sufficient GPT confidence, a photo GPT marks safe (no people, readable door codes, or personal information), no GPT concerns, and a coherent located suggestion or existing-restroom update.

Research leads can never use autopilot. Every autopublished or auto-applied change carries an `autopilot` action in the operator trace, and the operator can turn the policy off at any time.

### Coverage expansion jobs


Job runners may use only city/open datasets and official business sources, must retain evidence and licensing information, and must write discoveries as private `venue_candidates`. A human approves any public restroom record.

This abstraction can queue a new city such as New York for private candidate review, but the public Relief map remains SF-only until that city has an approved, human-reviewed inventory. 



## Operator workspace

Open `/operator` on the deployed judge URL. It is a deliberately simple demo gate: one shared password, no user accounts. The operator page has a live human-review queue, high-level moderation stats, and an audit tab that exposes GPT's stored reason, proposed tags, submission metadata, and a short-lived signed URL for the contributor-owned photo.

Approving a photo-backed suggestion or update also publishes that approved restroom photo to the public record; no second moderation click is required. Pending and rejected evidence stays private. After adding this capability to an existing project, open `/operator` and press **Refresh** once to backfill photos from previously approved submissions.

Add these **server-only** variables to the existing `relief-sf` Vercel project (Production and Preview), then redeploy from Git:

```env
OPERATOR_PASSWORD=choose-a-shared-demo-password
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-secret-key
```


### Research-lead triage

The **Research leads** tab is a scale pipeline for the 3,444 OpenStreetMap-derived venue leads. The operator can choose **Process next 100**. GPT-5.6 can publish a lead only when the source itself explicitly supports a restroom/public-facility listing and the model reaches the 92% confidence threshold. Published records are visibly labeled **GPT-reviewed lead**, never city-verified. All other leads remain private research records. A server-side GPT-5.6 batch classifies each source lead as one of:

- `publish_to_map` — explicit source evidence plus ≥92% GPT confidence; added to the map as a GPT-reviewed lead;
- `evidence_collection` — worth collecting permitted official/city evidence next;
- `needs_judgment` — potentially relevant, but insufficient source evidence; or
- `reject` — clearly irrelevant or unusable.

Every row retains source name, source URL, and license. GPT-5.6 cannot invent hours or access details; map-published leads retain their OpenStreetMap provenance and remain distinct from city and community-verified records.

The batch action requires one extra **server-only** Vercel variable:

```env
OPENAI_API_KEY=sk-your-api-key
```

Set it in Production and Preview, then redeploy. It is never sent to the browser or stored in Supabase.

Review pending records from the browser, or use the local operator script when developing:

```bash
node scripts/moderate.mjs pending
node scripts/moderate.mjs review-photo UPDATE_ID
node scripts/moderate.mjs approve-update UPDATE_ID
```


## Build Week submission checklist

- [ ] Public Vercel demo URL works without login
- [ ] Repository is public, or shared with `testing@devpost.com` and `build-week-event@openai.com`
- [ ] README includes setup, sample data, and this trust model
- [ ] GPT-5.6 photo review has been deployed and demonstrated on one safe contributor photo
- [ ] ~3-minute public YouTube video shows: immediate-restroom flow, Mapbox business suggestion, city-verified data, pending moderation, and GPT-5.6 review
- [x ] Video voiceover explains the concrete Codex workflow and GPT-5.6 review role
- [x] Submission includes the primary Codex `/feedback` Session ID - 
