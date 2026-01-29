/**
 * Simple markdown to HTML renderer for chat messages
 * Supports: bold, italic, code, code blocks, links, lists, headers
 */

export function renderMarkdown(text: string): string {
  const codeBlocks: string[] = [];
  let source = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const langClass = lang ? ` class="lang-${lang}"` : "";
    const escaped = escapeHtml(code.trim());
    codeBlocks.push(`<pre${langClass}><code>${escaped}</code></pre>`);
    return `@@BLOCK${codeBlocks.length - 1}@@`;
  });

  source = escapeHtml(source);
  source = source.replace(/(@@BLOCK\d+@@)/g, "\n$1\n");

  // Inline code
  source = source.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Headers (h1-h3)
  source = source.replace(/^### (.+)$/gm, "<h4>$1</h4>");
  source = source.replace(/^## (.+)$/gm, "<h3>$1</h3>");
  source = source.replace(/^# (.+)$/gm, "<h2>$1</h2>");

  // Bold and italic
  source = source.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  source = source.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  source = source.replace(/\*(.+?)\*/g, "<em>$1</em>");
  source = source.replace(/__(.+?)__/g, "<strong>$1</strong>");
  source = source.replace(/_(.+?)_/g, "<em>$1</em>");

  // Links
  source = source.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );

  const lines = source.split(/\r?\n/);
  const blocks: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (/^@@BLOCK\d+@@$/.test(trimmed)) {
      blocks.push(trimmed);
      i++;
      continue;
    }

    if (/^---$/.test(trimmed)) {
      blocks.push("<hr>");
      i++;
      continue;
    }

    if (/^<h[234]>/.test(trimmed)) {
      blocks.push(trimmed);
      i++;
      continue;
    }

    if (/^&gt; /.test(trimmed)) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("&gt; ")) {
        quoteLines.push(lines[i].trim().slice(5));
        i++;
      }
      blocks.push(`<blockquote>${quoteLines.join("<br>")}</blockquote>`);
      continue;
    }

    const isTableRow = (value: string) =>
      value.includes("|") && !/^<h[234]>/.test(value.trim());
    const isTableDivider = (value: string) =>
      /^[\s|:-]+$/.test(value.trim()) && value.includes("-");

    if (isTableRow(trimmed) && i + 1 < lines.length) {
      const divider = lines[i + 1].trim();
      if (isTableDivider(divider)) {
        const readCells = (row: string) =>
          row
            .split("|")
            .map((cell) => cell.trim())
            .filter((cell, idx, arr) => {
              const isEdge = (idx === 0 || idx === arr.length - 1) && cell === "";
              return !isEdge;
            });

        const headerCells = readCells(lines[i]);
        const rows: string[] = [];
        i += 2;
        while (i < lines.length && lines[i].trim() && isTableRow(lines[i])) {
          const cells = readCells(lines[i]);
          rows.push(
            `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`,
          );
          i++;
        }

        const headerHtml = `<tr>${headerCells
          .map((c) => `<th>${c}</th>`)
          .join("")}</tr>`;
        const bodyHtml = rows.length
          ? `<tbody>${rows.join("")}</tbody>`
          : "";
        blocks.push(`<table><thead>${headerHtml}</thead>${bodyHtml}</table>`);
        continue;
      }
    }

    if (/^(\d+\.)\s+/.test(trimmed) || /^[-*]\s+/.test(trimmed)) {
      const isOrdered = /^(\d+\.)\s+/.test(trimmed);
      const items: string[] = [];
      while (
        i < lines.length &&
        (isOrdered
          ? /^(\d+\.)\s+/.test(lines[i].trim())
          : /^[-*]\s+/.test(lines[i].trim()))
      ) {
        const itemLine = lines[i].trim().replace(/^(\d+\.)\s+|^[-*]\s+/, "");
        items.push(`<li>${itemLine}</li>`);
        i++;
      }
      const tag = isOrdered ? "ol" : "ul";
      blocks.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^@@BLOCK\d+@@$/.test(lines[i].trim()) &&
      !/^---$/.test(lines[i].trim()) &&
      !/^<h[234]>/.test(lines[i].trim()) &&
      !/^&gt; /.test(lines[i].trim()) &&
      !/^(\d+\.)\s+/.test(lines[i].trim()) &&
      !/^[-*]\s+/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(`<p>${paraLines.join("<br>")}</p>`);
  }

  let html = blocks.join("\n");
  html = html.replace(/@@BLOCK(\d+)@@/g, (_match, idx) => {
    const i = Number(idx);
    return codeBlocks[i] || "";
  });

  return html;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Strip markdown formatting and return plain text
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "") // code blocks
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/#{1,6}\s+/g, "") // headers
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1") // bold italic
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/\*(.+?)\*/g, "$1") // italic
    .replace(/__(.+?)__/g, "$1") // bold
    .replace(/_(.+?)_/g, "$1") // italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
    .replace(/^[-*] /gm, "") // list items
    .replace(/^\d+\. /gm, "") // numbered lists
    .replace(/^> /gm, "") // blockquotes
    .trim();
}
