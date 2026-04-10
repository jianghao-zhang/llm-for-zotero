---
id: write-to-obsidian
match: /\b(write|save|export|send)\b.*\bobsidian\b/i
match: /\bobsidian\b.*\b(note|write|save|export)\b/i
match: /\bto\s+obsidian\b/i
match: /\bobsidian\b.*\bvault\b/i
---

## Writing Notes to Obsidian

When the user asks to write, save, or export content to Obsidian, follow this workflow.
This skill is content-agnostic — it works for any note type: single paper summary, literature review, multi-paper comparison, research notes, or free-form writing.

### Prerequisites
- The user's Obsidian vault path and default folder are provided in the system prompt under "Obsidian configuration". If missing, tell the user to configure Obsidian in the plugin preferences (Settings > Agent tab).
- The default folder is used when the user doesn't specify a folder. If the user specifies a different folder, write there instead.

### Recipe

**Step 1 — Gather content:**
- For a single paper: read via `file_io(read, '{mineruCacheDir}/full.md')` if MinerU available, otherwise `read_paper`.
- For multi-paper notes (reviews, comparisons): use `query_library` + `read_paper`/`file_io` for each paper.
- For free-form notes: use whatever the user provides or requests.

**Step 2 — Look up citation keys (if citing papers):**
- Use `read_library(sections:['metadata'])` to get the `citationKey` (or `citekey`) for each referenced paper.
- In the note body, cite papers using **Pandoc citation syntax**: `[@citekey]` (e.g., `[@smith2024deep]`).
- This renders as proper citations in Obsidian via Zotero Integration or Pandoc plugins.
- Optionally add a `## References` section at the end listing full citations.

**Step 3 — Compose the Obsidian note:**
- Use the note template from the system prompt as the skeleton.
- Fill in `{{title}}` with the note title (paper title, review topic, or user-provided title).
- Fill in `{{date}}` with today's date in YYYY-MM-DD format.
- Fill in `{{content}}` with the full note body.
- Add extra YAML frontmatter fields as appropriate for the content type (e.g., `authors`, `doi`, `journal` for paper notes; nothing extra for free-form).
- Use standard Markdown formatting compatible with Obsidian.

**Step 4 — Include figures (when appropriate and MinerU cache is available):**
- The MinerU cache contains extracted figures in `{mineruCacheDir}/images/`.
- When figures would add value to the note (e.g., result plots, diagrams, key tables), copy and include them.
- Use `run_command` to copy needed image files from `{mineruCacheDir}/images/` to `{vaultPath}/{folder}/{attachmentsFolder}/{sanitized-title}/` (use the native path separator from the runtime platform section in the system prompt).
- Reference copied images with relative paths: `![Figure caption]({attachmentsFolder}/{sanitized-title}/fig1.png)`.
- Use judgement: a detailed paper analysis benefits from figures; a quick free-form note may not.

**Step 5 — Write the note file:**
- Construct the file path: `{vaultPath}/{folder}/{sanitized-title}.md` (use the native path separator from the runtime platform section in the system prompt).
- Sanitize the title for filesystem use: replace special characters with hyphens, limit to 80 chars.
- Call `file_io(write, filePath, noteContent)`.

### Key rules
- Always use `file_io` for writing — never output the full note text in chat.
- Use the user's configured template. If no template is configured, use sensible defaults with YAML frontmatter.
- Use `[@citekey]` Pandoc syntax when referencing papers — look up citekeys from Zotero metadata.
- If writing fails, report the error clearly with the attempted path.
- Use the native path separator provided in the runtime platform section of the system prompt. Never mix separators.

### Budget
Total tool calls: 2–5 (read content, optionally look up citekeys, optionally copy images, write note file).
