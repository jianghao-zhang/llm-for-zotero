/**
 * Simple markdown to HTML renderer for chat messages
 * Supports: bold, italic, code, code blocks, links, lists, headers
 */

export function renderMarkdown(text: string): string {
  let html = escapeHtml(text);

  // Code blocks (must be first to avoid conflicts)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const langClass = lang ? ` class="lang-${lang}"` : "";
    return `<pre${langClass}><code>${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Headers (h1-h3)
  html = html.replace(/^### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^## (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^# (.+)$/gm, "<h2>$1</h2>");

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
  html = html.replace(/_(.+?)_/g, "<em>$1</em>");

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );

  // Unordered lists
  html = html.replace(/^[-*] (.+)$/gm, "<li>$1</li>");

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

  // Wrap consecutive li elements in ul
  html = html.replace(/(<li>[\s\S]*?<\/li>)(\n<li>)/g, "$1$2");
  html = html.replace(/(^|\n)(<li>[\s\S]*?<\/li>)+/g, (match) => {
    return `<ul>${match.trim()}</ul>`;
  });

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");

  // Horizontal rules
  html = html.replace(/^---$/gm, "<hr>");

  // Line breaks - convert double newlines to paragraphs
  html = html.replace(/\n\n+/g, "</p><p>");
  html = html.replace(/\n/g, "<br>");

  // Wrap in paragraph
  html = `<p>${html}</p>`;

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, "");
  html = html.replace(/<p>(<(?:h[234]|pre|ul|blockquote|hr))/g, "$1");
  html = html.replace(/(<\/(?:h[234]|pre|ul|blockquote|hr)>)<\/p>/g, "$1");

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
