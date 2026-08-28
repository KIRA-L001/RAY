/**
 * Wrap untrusted text (customer messages, tool output) so the model treats it as
 * data, not instructions. Escapes `<` so an attacker cannot close the delimiter
 * early, strips CR, and bounds length to limit prompt-stuffing DoS.
 */
export function wrapUntrusted(text: string, source: string, maxLen = 16000): string {
  const safe = String(text)
    .replace(/</g, "&lt;")
    .replace(/\r/g, "")
    .slice(0, maxLen);
  return `<<${source}>>\n${safe}\n<</${source}>>`;
}
