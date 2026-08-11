---
name: write-note
id: write-note
description: Manual-only helper for saving the current answer or reading notes to Zotero or a Markdown file. Never activate unless the user explicitly selects this skill.
version: 8
contexts: any
activation: manual
match: /\b(write|save|append|edit)\b.*\b(note|notes)\b/i
---

# Save a note

Follow the user's requested destination and wording. Do not force a template, section structure, frontmatter schema, footer, citation style, or figure workflow unless the user asks for one.

- For a Zotero note, identify the exact parent item key and use `zcli write note ITEMKEY --content "..." --dry-run --format json`. Execute only when the user explicitly asked to perform the write in this turn.
- For a Markdown file, use normal Codex file tools at the requested path.
- Preserve useful Zotero source anchors and links already present in the content.
- When editing or appending, inspect the existing target first and make only the requested change.
