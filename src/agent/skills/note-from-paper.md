---
id: note-from-paper
match: /\b(create|make|write|draft|generate)\b.*\b(note|summary note|reading note|notes?)\b.*\b(for|from|about|on)\b.*\b(paper|article|this)\b/i
match: /\b(note|notes?)\b.*\b(for|from|about|on)\b.*\b(paper|article|this|these)\b/i
match: /\b(reading notes?|study notes?|literature notes?|research notes?)\b/i
match: /\b(summarize|summarise)\b.*\b(into|as|to)\b.*\b(note|notes?)\b/i
---

## Writing Notes from Papers — read then write

When the user asks to create a note summarizing a paper or to generate reading
notes, follow this efficient two-step workflow.

### Recipe

**Step 1 — Read the paper:**
- If `mineruCacheDir` is available: use `file_io(read, '{mineruCacheDir}/full.md')`.
- Otherwise: use `read_paper` for the overview, then optionally one `search_paper` call for key results/methods if the user wants detail beyond the abstract.

**Step 2 — Consider including figures (when MinerU cache is available):**
- The MinerU cache contains extracted figures in `{mineruCacheDir}/images/`.
- When figures would genuinely aid understanding (e.g., explaining results, architecture, or methods), embed them in the note.
- For Zotero notes: use `![Figure N](file:///{mineruCacheDir}/images/filename.png)` — the note tool auto-imports these as embedded attachments.
- Use your judgement: a detailed reading note benefits from figures; a quick summary may not need any.
- Place figures near the text that discusses them.

**Step 3 — Create the note:**
Call `edit_current_note(mode:'create')` with the note content. The note is
created directly.

### Key rules
- NEVER output the note text in chat. Always use `edit_current_note`.
- Keep the read phase minimal: 1 call (MinerU) or 1–2 calls (read_paper/search_paper). Do not read the entire paper section by section.
- When MinerU cache is available, figures are available for inclusion — use them when they add value to the note.

### Budget
Total tool calls: 2–4 (one read, optionally one more for detail, one note write).
