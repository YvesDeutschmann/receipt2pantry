# Meald — Pantry Layer 3: Voice Input
**Document type:** Feature Brief  
**Stage:** 3 of 3 — builds on Stages 1 and 2  
**Status:** Active  
**Master brief:** [meald-pantry-master.md](./meald-pantry-master.md) — read this first

---

## What This Is

A voice input mode that lets users narrate their pantry in one continuous spoken phrase — not item by item, but as a natural stream: *"I've got pasta, rice, canned tomatoes, black beans, olive oil, some parmesan, chicken thighs in the freezer, flour, eggs, hot sauce..."*

The system transcribes the audio, extracts a structured list of canonical pantry items, and presents them in a **single review card** for one-tap batch confirmation. This is not item-by-item voice confirmation — it is a single narration followed by a single review. The distinction matters: item-by-item confirmation eliminates the speed advantage of voice entirely.

---

## User Stories

> As a user setting up my pantry, I can speak everything I see in my kitchen at once so that I can add many items in under 30 seconds without tapping or typing.

> As a returning user, I can quickly add several items to my pantry by speaking them rather than searching one by one.

---

## Position in the Arc

Voice is an **alternative input mode**, not a replacement for the staples template. It surfaces as an optional path within the existing arc — users who prefer speaking to tapping can switch to voice mid-template or use it as a follow-up after completing the template.

The progress bar and the "What's for Dinner" destination remain the same regardless of which input method the user uses. Voice is a faster on-ramp for some users; the arc and payoff do not change.

---

## Entry Points

**Entry point 1 — Stage 1 template flow**  
A microphone button appears at the top of the staples template with the label: **"Or just tell us what you have"**. Low-prominence — an alternative path, not the primary CTA. Opens the voice recording flow as a sheet over the template.

**Entry point 2 — Search & add screen**  
The search bar includes a microphone icon on the right side. Tapping it switches from text to voice mode. The same transcription and review flow applies.

**Entry point 3 — Pantry screen**  
The persistent "+" button on the pantry screen offers **"Search"** and **"Tell me"** as options in a simple action sheet.

---

## Voice Recording Flow

### Step 1 — Recording

On activation, show a full-screen recording state with:
- A large animated waveform confirming the mic is live
- Prompt copy: **"Tell us what you have — just say it naturally"**
- Example in smaller text: *"pasta, olive oil, chicken thighs, canned tomatoes, some hot sauce..."*
- A **Stop** button — user taps when done. Do not auto-stop on silence; pauses mid-narration are normal
- A **Cancel** link that discards without saving

No item-by-item confirmation while recording. The user speaks freely until they tap Stop.

### Step 2 — Processing

After Stop, show a brief processing state while:
1. Audio is transcribed to text
2. Transcript is sent to the ingredient extraction service (see below)
3. Extracted items are resolved against the canonical ingredient list

Target: complete in under 3 seconds on a standard connection. If longer, show: **"Reading your pantry..."**

### Step 3 — Review card

A bottom sheet showing:
- Headline: **"We heard [N] items — does this look right?"**
- A grid of item chips — each chip shows the item name and has an × to remove it
- An **"Add something"** link that opens a mini search bar inline for missed items
- Single CTA: **"Add all to my pantry"** (count updates as chips are removed)
- A **"Start over"** link if the extraction was substantially wrong

Tapping **"Add all to my pantry"** writes all items in a batch, advances the progress bar (if still in onboarding), and routes to the "What's for Dinner" result screen if the arc is complete.

---

## Ingredient Extraction Service

A two-step pipeline:

**Step 1 — Transcription**  
Convert audio to text using a service that handles food vocabulary, informal language, brand names, abbreviations, filler words, and quantity language ("a couple cans of", "some", "a big bag of").

**Step 2 — Extraction and normalization**  
Pass the raw transcript to a language model with instructions to:
- Extract only food/ingredient items, ignoring non-food words and filler
- Normalize to canonical names from the Meald ingredient list ("parm" → "Parmesan", "chx thighs" → "Chicken thighs", "evoo" → "Olive oil")
- Treat quantity language as presence signals only — "a couple cans of tomatoes" → one instance of "Canned tomatoes", no quantity value
- Return a JSON array of canonical item names
- Place items it cannot confidently map into a separate `uncertain` array — do not silently drop them

**Handling uncertain items:**  
If the `uncertain` array is non-empty, surface them in the review card under: **"We weren't sure about these — do you mean...?"** with a best-guess suggestion and Yes / No per item. Prevents silent data loss without blocking the main flow.

**Failure state:**  
If transcription or extraction fails entirely, return to the recording screen: **"We had trouble hearing that — try again, or type instead."** Search & add is always available as a fallback.

---

## Deduplication

Before writing voice-extracted items to the pantry, apply the same deduplication logic as Stage 1:
- Check for existing confirmed pantry records for each canonical item
- Skip items already present — no duplicates
- Surface a quiet summary in the review card: **"3 items were already in your pantry"** as a note, not a blocking state

---

## What This Stage Does Not Include

- Real-time transcription display while recording (a post-recording review card is better UX — live transcription adds anxiety without adding value)
- Per-item voice confirmation (eliminates the speed advantage of voice — never implement this)
- Continuous listening / always-on mode (push-to-talk only)
- Multilingual transcription (future stage)
