import { config } from "../../package.json";

const OBSIDIAN_VAULT_PATH_KEY = `${config.prefsPrefix}.obsidianVaultPath`;
const OBSIDIAN_TARGET_FOLDER_KEY = `${config.prefsPrefix}.obsidianTargetFolder`;
const OBSIDIAN_ATTACHMENTS_FOLDER_KEY = `${config.prefsPrefix}.obsidianAttachmentsFolder`;
const OBSIDIAN_NOTE_TEMPLATE_KEY = `${config.prefsPrefix}.obsidianNoteTemplate`;

export function getObsidianVaultPath(): string {
  const value = Zotero.Prefs.get(OBSIDIAN_VAULT_PATH_KEY, true);
  return typeof value === "string" ? value : "";
}

export function setObsidianVaultPath(value: string): void {
  Zotero.Prefs.set(OBSIDIAN_VAULT_PATH_KEY, value, true);
}

export function getObsidianTargetFolder(): string {
  const value = Zotero.Prefs.get(OBSIDIAN_TARGET_FOLDER_KEY, true);
  return typeof value === "string" ? value : "Zotero Notes";
}

export function setObsidianTargetFolder(value: string): void {
  Zotero.Prefs.set(OBSIDIAN_TARGET_FOLDER_KEY, value, true);
}

export function getObsidianAttachmentsFolder(): string {
  const value = Zotero.Prefs.get(OBSIDIAN_ATTACHMENTS_FOLDER_KEY, true);
  return typeof value === "string" ? value : "assets";
}

export function setObsidianAttachmentsFolder(value: string): void {
  Zotero.Prefs.set(OBSIDIAN_ATTACHMENTS_FOLDER_KEY, value, true);
}

export function getObsidianNoteTemplate(): string {
  const value = Zotero.Prefs.get(OBSIDIAN_NOTE_TEMPLATE_KEY, true);
  return typeof value === "string" ? value : "";
}

export function setObsidianNoteTemplate(value: string): void {
  Zotero.Prefs.set(OBSIDIAN_NOTE_TEMPLATE_KEY, value, true);
}

export function getDefaultObsidianNoteTemplate(): string {
  return `---
title: "{{title}}"
date: {{date}}
tags: [zotero]
---

# {{title}}

{{content}}

---
*Written to Obsidian by LLM-for-Zotero*`;
}

export function isObsidianConfigured(): boolean {
  return getObsidianVaultPath().trim().length > 0;
}
