/**
 * Tiny inline markup for on-screen text fields (after HTML escaping):
 *   *từ*       → accent-colored emphasis
 *   **từ**     → bold
 *   `code`     → inline code chip
 *   ==từ==     → marker highlight (animated sweep)
 */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function inline(s: string): string {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, '<code class="ic">$1</code>');
  out = out.replace(/==([^=]+)==/g, '<mark class="hl"><span class="hl-bar"></span><span class="hl-text">$1</span></mark>');
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>");
  return out;
}

/** Strip the markup (for captions / plain text). */
export function plain(s: string): string {
  return s.replace(/`([^`]+)`/g, "$1").replace(/==([^=]+)==/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
}
