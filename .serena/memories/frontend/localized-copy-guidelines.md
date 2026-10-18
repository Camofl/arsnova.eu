# Localized Copy Guidelines

Do not use Google Translate or similarly literal machine translation as the source for user-facing copy in any locale.

arsnova.eu is used in didactic and live-moderation contexts, so localized language must be idiomatic, media-aware, and appropriate for teachers, lecturers, trainers, and presenters. This applies to all supported locales, including German, English, French, Italian, and Spanish.

When working on copy or i18n files:

- Translate meaning, tone, and teaching intent rather than sentence structure.
- Prefer natural domain language for education, workshops, audience response, live Q&A, quiz, moderation, and feedback.
- Avoid literal Germanisms or English calques in localized strings.
- Keep terminology consistent across UI, landing pages, help pages, and docs, but adapt phrasing to what sounds native in each locale.
- Treat locale updates as editorial localization, not mechanical translation.

## UI-Copy-Optimierung (Host- und Teilnahme-UI)

Apply these on wording/UX-copy tasks, especially dialogs, radio groups, and selects:

- Short and immediately understandable. Prefer a simple noun over a compound (`Anonym`, not `Anonymmodus`).
- Drop redundant copy. If the title, legend, options, or primary button already state the decision, do not add an intro sentence that repeats it.
- Put secondary helper copy and optional settings behind native `details/summary` so the first screen stays short. On the Q&A create wizard: title field shows only the 200-character limit; timezone and deadline preview stay visible under access; **Teilnahmeprofil** stays collapsed at the bottom; recovery hints under **Wiederherstellung und Support**. When Q&A already exists, edit the heading on the wall (limit only) and omit the title field from settings. Toggle pre-moderation on the question wall, not in Q&A settings.
- One idea per hint. Keep the first useful sentence; drop legal/disclaimer follow-ups from operational UI. Full caveats stay in privacy/legal surfaces only.
- Name options by what they offer, not by abstract mode or school level. Example: nickname themes are content lists (`Bunte Tier-Icons` … `Nobelpreisträger:innen`), not Kita/Grundschule/Oberstufe.
- Same user-facing names, same option order, same i18n IDs on every surface that sets or shows the same choice (host dialog, join, quiz new/edit, preset toast).
- Name the lemma-smoothing control **Wort-Glättung**, not bare **Glättung** (Q&A and freetext word cloud, including presenter pills).
- Clean stale XLF units after copy restructures. Do not leave parallel IDs for the same label.

Current nickname-theme order and IDs (`sessionParticipation.theme*`):

1. `KINDERGARTEN` — Bunte Tier-Icons
2. `PRIMARY_SCHOOL` — Märchenfiguren
3. `MIDDLE_SCHOOL` — Entdecker und Superhelden
4. `HIGH_SCHOOL` — Philosophen und Forscher
5. `NOBEL_LAUREATES` — Nobelpreisträger:innen

## Verwandte Memories:

- `mem:core`
- `mem:frontend/i18n-ui`
- `mem:modules/frontend`
