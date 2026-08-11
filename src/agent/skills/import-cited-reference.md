---
name: import-to-library
id: import-to-library
description: Manual-only helper for importing a specifically identified paper into Zotero. Never activate unless the user explicitly selects this skill.
version: 4
contexts: any
activation: manual
match: /\b(import|add)\b.*\b(paper|reference)\b.*\b(zotero|library)\b/i
---

# Import a paper into Zotero

Resolve only the paper identities the user requested. Use the matching `zcli import` command with `--dry-run --format json` first, show or validate the resolved metadata, then add `--execute` only when the user explicitly asked to perform the import in this turn.

Batch several identifiers when practical. Report ambiguous or unresolved papers instead of guessing. Do not turn the import into a literature-review or paper-reading workflow.
