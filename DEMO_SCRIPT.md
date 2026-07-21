# Relief SF — three-minute narration

## 0:00–0:20

“Hi, I’m David, and this is Relief, a mobile-first San Francisco restroom finder I built during OpenAI Build Week. I set the user flows, trust policy, and publication rules. Codex accelerated the design, architecture, implementation, and debugging. GPT-5.6 runs inside the product as a bounded evidence reviewer.”

## 0:20–0:48

“Relief starts with official DataSF restroom records. In an urgent moment, I’m Feeling Lucky finds the physically closest option. I can also search for RH, inspect its community-verified photo, description, access information, and tags, then get directions. Closing it returns me to the full map, where filters narrow the results.”

## 0:48–1:22

“The map grows through community contributions without requiring an account. Mapbox place discovery finds Wooden Coffeehouse, so I do not need its address. I add access details, a cleanliness rating, and a restroom-only photo, preview it, and submit. The record stays private while GPT-5.6 checks whether the image is a restroom and whether it contains people, personal information, or a readable door code.”

## 1:22–2:12

“In Operator Review, GPT-5.6 turns private evidence into a reason, confidence, supported facts, proposed changes, and concerns. Needs Judgment requires a person. GPT Approved is eligible for human publication. Operator Approved and Rejected preserve final decisions.

“Autopilot is off by default. Its threshold is configurable, but it can act only on a safe, photo-backed submission with a valid place, no concerns, and a qualifying outcome. Here, GPT notes that the photo alone cannot prove venue identity. Because I submitted it from my own visit, I can make the operator decision and publish. Every action remains in the activity trace. A banana submitted as evidence is rejected and never reaches the map.”

## 2:12–2:43

“Research Leads is a separate pipeline, never community autopilot. GPT-5.6 asks whether each source explicitly establishes a restroom or public facility. Only explicit evidence at or above the 92 percent gate can reach the map, labeled GPT-reviewed lead—never city-verified. Generic businesses remain in research or Needs Judgment instead of becoming unsupported claims.”

## 2:43–2:58

“Relief combines a useful map today with an evidence-aware system for responsible expansion. Codex gave me speed across disciplines; GPT-5.6 gives the product structured review and scale; and I remain responsible for the product and trust decisions.”
