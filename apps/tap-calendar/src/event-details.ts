/** Calendar providers accept HTML descriptions; the event editor accepts plain text. */
export function providerDescription(text: string): string {
  return text.trim().replace(/&/gu, "&amp;").replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&#39;")
    .replace(/\r?\n/gu, "<br>");
}
