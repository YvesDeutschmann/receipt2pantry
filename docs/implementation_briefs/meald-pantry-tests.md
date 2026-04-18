# Cursor Prompt
**Copy and paste the following prompt into Cursor to begin test planning:**

> @meald-pantry-tests.md Review these comprehensive E2E and integration test scenarios for the new Pantry Population feature. Scan our current test suite (including any Python/pytest or C# unit testing frameworks we are using for the backend, and our frontend/E2E frameworks).
> 
> 1. Map these scenarios against our existing test coverage. Identify what is missing.
> 2. Propose a test implementation plan. Group the tests logically (e.g., unit tests for the canonical ingredient normalizer, integration tests for the deduplication logic, and E2E tests for the UI flows). 
> 3. Draft the first batch of E2E tests for the 'Golden Path' Cold Start Arc, ensuring we mock the background receipt sync appropriately.

---

# Meald Pantry Feature — Comprehensive E2E & Integration Test Scenarios
**Target:** Pantry Population Arc (Layers 1, 2, and 3)

## 1. The Cold Start Arc (Layer 1 - Staples Template)

### Scenario 1.1: The Golden Path (Happy Path)
* **Given:** A cold-start user has just connected their grocery account.
* **When:** The Staples Template opens, the user leaves the 6 defaults checked, checks 2 additional items ("Vegetable oil", "Cinnamon"), and taps "Done — show me what's for dinner".
* **Then:** 8 items are written to the pantry in a single batch transaction. The progress bar advances to "Step 3 complete". The "What's for Dinner" button activates with a pulse animation. The user is routed directly to the recipe result screen.

### Scenario 1.2: The "Skip for Now" Fast Path
* **Given:** The Staples Template is open.
* **When:** The user immediately taps the low-prominence "Skip for now" link at the top.
* **Then:** The 6 pre-selected defaults are saved to the pantry. The progress bar completes. The "What's for Dinner" button activates immediately based on those 6 staples alone.

### Scenario 1.3: Background Receipt Sync Collision & Silent Enrichment
* **Given:** The background receipt sync completes while the user is viewing the Staples Template, identifying "Olive oil" with a specific purchase date.
* **When:** The user leaves "Olive oil" checked in the template and taps "Done".
* **Then:** A duplicate "Olive oil" record is NOT created. The existing receipt record is enriched with `template_confirmed: true` and retains its purchase date. A silent toast surfaces: "We matched 1 of your staples to your recent receipts ✓".

### Scenario 1.4: Background Sync Timeout Fallback
* **Given:** The user finishes selecting items in the template and taps "Done".
* **When:** The background receipt sync has NOT yet completed.
* **Then:** The UI is not blocked. The "What's for Dinner" button activates based on the staples alone. A quiet note is displayed on the result screen: "Your recent groceries are still syncing — we'll update your suggestions shortly."

### Scenario 1.5: Abandonment and Auto-Save
* **Given:** The user unchecks "Salt" and checks "Sesame oil" in the staples template.
* **When:** The user dismisses the bottom sheet (swipes down) without tapping "Done".
* **Then:** An inline prompt appears: "Save what you've selected so far?" with "Save" and "Discard" options.
* **When (Sub-action):** The user taps "Save".
* **Then:** The partial state is saved to the pantry. The onboarding arc remains incomplete.

### Scenario 1.6: Abandonment without Changes
* **Given:** The user opens the Staples Template.
* **When:** The user makes zero changes to the defaults and dismisses the sheet.
* **Then:** The sheet closes immediately without prompting the user to save or discard.

---

## 2. Search & Add (Layer 2)

### Scenario 2.1: Rapid Sequential Add (Happy Path)
* **Given:** The user opens the search bar from the pantry.
* **When:** The user types "soy", taps "Soy sauce" from the autocomplete, then types "tahi", and taps "Tahini".
* **Then:** "Soy sauce" is added instantly on tap with an inline "[Item] added ✓" confirmation. No modal interrupts the flow. The search bar resets to empty, the keyboard stays up, and "Tahini" is added similarly on the second sequence.

### Scenario 2.2: Autocomplete Normalization (Aliases)
* **Given:** The user opens the search bar.
* **When:** The user types a known abbreviation, such as "ev olive".
* **Then:** The autocomplete suggestions normalize the input and display "Olive oil" as a canonical option.

### Scenario 2.3: Freeform Input Rejection
* **Given:** The user opens the search bar.
* **When:** The user types an unrecognized string like "Grandma's secret hot sauce" and attempts to submit or hit enter.
* **Then:** No freeform record is created. An inline message appears: "We don't recognize that yet — try a different name".

### Scenario 2.4: Filtering Existing Inventory
* **Given:** "Garlic" is already a confirmed item in the user's pantry.
* **When:** The user types "Gar" into the search bar.
* **Then:** "Garlic" does NOT appear in the autocomplete suggestions.

### Scenario 2.5: The Contextual Recipe Prompt (Trigger)
* **Given:** A user browses a recipe containing 10 ingredients. 8 are in their pantry, 2 are not (and are not universal assumptions like water/salt).
* **When:** The user taps to bookmark the recipe.
* **Then:** A "Quick pantry check" bottom sheet appears with the 2 missing items as toggle cards.
* **When (Sub-action):** The user taps "I have it" on one item.
* **Then:** The item is immediately added to the pantry.

### Scenario 2.6: The Contextual Recipe Prompt (Boundary Check)
* **Given:** A user browses a recipe where 5 ingredients are missing from their pantry.
* **When:** The user bookmarks the recipe.
* **Then:** The "Quick pantry check" prompt does NOT trigger, as it strictly limits interruptions to recipes with 1–3 missing ingredients.

---

## 3. Voice Input (Layer 3)

### Scenario 3.1: Continuous Stream (Happy Path)
* **Given:** The user taps the microphone icon from the search bar or template.
* **When:** The user narrates: "I've got pasta, a couple cans of black beans, and olive oil", then taps Stop.
* **Then:** A review card appears showing exactly three canonical chips: "Pasta", "Canned black beans", and "Olive oil" (quantity language ignored).
* **When (Sub-action):** The user taps "Add all to my pantry".
* **Then:** All three items are batched and saved to the pantry.

### Scenario 3.2: Ambiguous/Uncertain Items
* **Given:** The user taps the microphone icon.
* **When:** The user narrates: "I have flour and some weird green alien sauce", then taps Stop.
* **Then:** The review card shows "All-purpose flour" in the confirmed section. Below it, a section titled "We weren't sure about these — do you mean...?" appears containing the unmapped phrase, preventing silent data loss.

### Scenario 3.3: Voice Deduplication Rule
* **Given:** The user already has "Olive oil" confirmed in their pantry.
* **When:** The user uses voice input and says "I have olive oil and pasta".
* **Then:** The review card shows a chip for "Pasta". It does not create a duplicate chip for Olive oil. A quiet note on the review card states: "1 item was already in your pantry".

### Scenario 3.4: Failed Transcription
* **Given:** The user activates voice input.
* **When:** The user mumbles incoherently or background noise ruins the audio, and they tap Stop.
* **Then:** The review card does not load empty. A state appears reading: "We had trouble hearing that — try again, or type instead," with the search bar available as a fallback.

---

## 4. Global Maintenance & Correction

### Scenario 4.1: Frictionless Recipe Card Correction ("I'm out")
* **Given:** The user is viewing a meal suggestion that calls for "Garlic" (which the system thinks the user has).
* **When:** The user realizes they are out of Garlic and taps the subtle "I'm out" indicator on the recipe card's ingredient row.
* **Then:** "Garlic" is removed from the pantry immediately. No confirmation dialog appears. The recipe card does not reload or close.

### Scenario 4.2: Recipe Card Correction Undo
* **Given:** The user taps "I'm out" on "Garlic" by accident.
* **When:** An undo toast appears stating "Removed Garlic from your pantry · Undo". The user taps "Undo" within 4 seconds.
* **Then:** "Garlic" is restored to the pantry seamlessly. The toast dismisses.
