---
name: analyze-figures
id: analyze-figures
description: Manual-only Zotero helper for inspecting a figure or table from the current paper. Never activate unless the user explicitly selects this skill.
version: 5
contexts: single-paper
activation: manual
match: /\b(analyze|inspect|explain)\b.*\b(figure|table|diagram)\b/i
---

# Analyze a figure from the current Zotero paper

Use the current PDF, selected page, screenshot, caption, and surrounding text as ordinary evidence. Inspect visual content directly with the available PDF/image tools. When additional local paper text is useful, query the exact Zotero item or attachment with `zcli`.

Keep the answer natural. Distinguish what is visibly present, what the caption or paper states, and what you infer. Preserve provided quote anchors or source labels when directly quoting so Zotero can keep citation and page-jump behavior.

Do not impose a fixed sequence of tool calls, output sections, note templates, or fallback package installation.
