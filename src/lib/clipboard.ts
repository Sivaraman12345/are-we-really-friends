/**
 * Cross-browser clipboard helper with robust fallback for insecure contexts (e.g. LAN / HTTP).
 *
 * Modern browsers restrict `navigator.clipboard` to secure contexts (HTTPS or localhost).
 * When accessed over a local network IP (http://192.168.x.x), `navigator.clipboard` is undefined.
 * This utility handles the standard API when available and falls back to `document.execCommand('copy')`.
 */

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false;

  // 1. Try modern navigator.clipboard API if available and secure
  if (
    typeof navigator !== "undefined" &&
    Boolean(navigator.clipboard) &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to document.execCommand fallback if permission rejected or failed
    }
  }

  // 2. Browser fallback: document.execCommand('copy') via temporary textarea
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;

    // Prevent scrolling to bottom of page on iOS / mobile
    textArea.style.position = "fixed";
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.width = "2em";
    textArea.style.height = "2em";
    textArea.style.padding = "0";
    textArea.style.border = "none";
    textArea.style.outline = "none";
    textArea.style.boxShadow = "none";
    textArea.style.background = "transparent";
    textArea.style.opacity = "0";
    textArea.style.pointerEvents = "none";
    textArea.setAttribute("readonly", "");

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    // Specific selection range for iOS Safari support
    if (typeof textArea.setSelectionRange === "function") {
      textArea.setSelectionRange(0, text.length);
    }

    const successful = document.execCommand("copy");
    document.body.removeChild(textArea);
    return Boolean(successful);
  } catch (err) {
    console.error("Clipboard copy failed:", err);
    return false;
  }
}
