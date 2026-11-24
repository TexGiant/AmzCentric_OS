# Case study bot

Turns measured wins from the AmzCentric OS Action Log into anonymized case studies, LinkedIn posts and proposal snippets. Every week it sends one **Case study packet** to Zain (email), the sales team, the Upwork bot and the Writer bot. Nothing is published or used outside AmzCentric until Zain approves it.

## Setup (once)

1. **App:** an admin opens **Settings → Brands** and, for each brand, sets a **Category** (e.g. "Supplements") and **Case studies**:
   - *Not allowed* (default): the brand is never used.
   - *Allowed, anonymized*: it appears as "a Supplements brand".
   - *Allowed with name*: only after the client has agreed in writing.
2. **Token:** OPS sets `INSIGHTS_API_TOKEN` (a long random string, e.g. `openssl rand -hex 32`) in Vercel and redeploys. The same value goes into the bot's secret settings on Zain's computer. Never paste it into a chat, issue, email or this file.
3. **Recipients**, kept in the bot's settings, not in this file (the repo is public): Zain's email, the sales team channel or address, the Upwork bot, the Writer bot.
4. **Schedule:** every Monday, 10:00 Pakistan time.

## What the bot does each week

1. **Fetch**
   ```bash
   curl -s -H "Authorization: Bearer $INSIGHTS_API_TOKEN" \
     "https://os.amzcentric.com/api/insights/case-studies?days=45&limit=10"
   ```
   - `401`: the token is wrong. `503`: the feed is switched off. Email Zain either way and stop.
   - `5xx`: retry once after 10 minutes, then email Zain and stop.
2. **Skip repeats.** Keep a local list of candidate `id`s already sent, and drop those.
3. **Pick** up to 3, strongest first (the feed is already sorted by `strength`). None left? Send the recipients "No new case study this week" and stop. Never stretch a weak result.
4. **Write** for each pick:
   - **Case study** (about 300 words): what we saw → what we changed → what happened → the lesson for other sellers.
   - **LinkedIn post** (under 150 words, one idea, ends with a question).
   - **Proposal snippet** for the Upwork bot (2–3 sentences: the problem, the change, the result).
   - **SEO notes** for the Writer bot: a working headline, 3–5 search phrases, and one blog angle.
5. **Self-check** each draft before sending:
   - [ ] Every number appears in the feed exactly (no new numbers, no extra rounding or extrapolating)
   - [ ] No brand, product, ASIN, campaign or person is named (unless `brand_named` is true)
   - [ ] The time window is stated ("over the 14 days after the change")
   - [ ] No promises ("will", "always", "guaranteed"); results are examples
6. **Send** one packet (template below) to Zain by email, the sales team, the Upwork bot and the Writer bot.
7. **After approval:** when Zain replies `APPROVED cs_xxxx` (with or without edits), send all recipients "APPROVED cs_xxxx — cleared for use" along with Zain's final text. Zain's edits win.

## Writing rules (give these to the bot as instructions)

```text
You write AmzCentric case studies from anonymized Action Log results.
Use ONLY the numbers in the feed. Never invent, round further, or extrapolate.
Never name a brand, product, ASIN, campaign or person; say "a {category} brand" — unless brand_named is true.
Every claim cites its numbers and window: "sales/day +22% over the 14 days after the change".
No guarantees ("will", "always", "guaranteed"); results are examples, not promises.
Structure: what we saw → what we changed → what happened → the lesson for other sellers.
Plain, specific language; no hype words ("skyrocketed", "game-changing").
If nothing qualifies, send "No new case study this week" instead of stretching a weak result.
```

## Packet template

```text
Subject: [DRAFT – NOT APPROVED] Case studies, week of <date>

DRAFT — not approved. Prepare, but do not publish, post, or send to anyone outside AmzCentric
until Zain replies "APPROVED <id>".

== cs_xxxx · <type of change> · <category> · <month> ==
Why it qualified: <why_it_qualified>
Key numbers: sales/day <+x%> · ACOS <a% → b%> · CVR <c% → d%> · over <window_days> days

-- Case study --
<~300 words>

-- LinkedIn post --
<under 150 words>

-- Upwork proposal snippet --
<2–3 sentences>

-- SEO notes (Writer bot) --
Headline: …
Search phrases: …
Blog angle: …

Self-check: numbers match feed ✓ · nothing identifying ✓ · window stated ✓ · no promises ✓
```

## Rules for the people and bots receiving the packet

- **Upwork bot:** use a case study in proposals only after it's approved. Anonymized results are fine to share; never add details that could identify the client.
- **Writer bot:** draft blog or SEO content from it, but publish only approved items, using Zain's final wording.
- **Sales team:** don't send drafts to prospects; use approved ones.

## Feed reference

`GET /api/insights/case-studies?days=45&limit=10` (`days` 14–120, `limit` 1–50). Read-only. Every call is recorded in the AmzCentric OS audit log.

A **win** means the change's full 14-day window has been measured, the brand had at least 5 orders in the 14 days before, and either:
- sales/day rose at least 15%, or
- ACOS fell at least 5 points while sales/day fell no more than 5%.

Each candidate:

| Field | Meaning |
|---|---|
| `id` | Stable id, the same every week (use it to skip repeats and in `APPROVED` replies) |
| `brand`, `brand_named` | "a Supplements brand", or the real name only when the client agreed |
| `category`, `month` | e.g. "Supplements", "November 2026" (no exact dates) |
| `change.type`, `change.what` | e.g. "Bid change", and the team's description with names, campaigns, ASINs and SKUs removed |
| `change.scope`, `change.ad_type` | "one campaign" or "whole brand"; SP / SB / SD |
| `results.*` | sales/day, orders/day and spend/day change (%), ACOS and CVR before → after (%), over `window_days` |
| `why_it_qualified`, `strength` | Why it counts as a win; its ranking score |
