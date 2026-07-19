# Candidate-venue queue (not map seed)

Use this only after the city seed is live. Run an Overpass query inside San Francisco's boundary for venue types such as `cafe`, `restaurant`, `fast_food`, `library`, `community_centre`, `marketplace`, and `department_store`.

Every result must enter `venue_candidates` with:

- `status = pending`
- `source_name = OpenStreetMap`
- `source_license = ODbL 1.0`
- the source object URL and retrieval time

Do **not** call these records restrooms and do not place them on the Relief map until a moderator verifies restroom evidence. Display `© OpenStreetMap contributors` with a link to https://www.openstreetmap.org/copyright anywhere this source is described.
