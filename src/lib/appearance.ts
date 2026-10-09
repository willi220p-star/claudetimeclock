/**
 * Appearance (D38): theme and text size, kept on this phone only. `system` follows the phone's
 * dark-mode setting. The same rule runs in the page head (APPEARANCE_SCRIPT) so there's no flash.
 */
export type Theme = "system" | "light" | "dark";
export type TextSize = "normal" | "large" | "larger";

export const THEMES: Theme[] = ["system", "light", "dark"];
export const TEXT_SIZES: TextSize[] = ["normal", "large", "larger"];
const KEY = "dgk-appearance";

export function parseAppearance(raw: string | null): { theme: Theme; text: TextSize } {
  let value: { theme?: unknown; text?: unknown } = {};
  try {
    value = JSON.parse(raw ?? "{}") ?? {};
  } catch {
    // Unreadable: use the defaults.
  }
  return {
    theme: THEMES.find((t) => t === value.theme) ?? "system",
    text: TEXT_SIZES.find((t) => t === value.text) ?? "normal",
  };
}

export function readAppearance() {
  try {
    return parseAppearance(localStorage.getItem(KEY));
  } catch {
    return parseAppearance(null);
  }
}

export function applyAppearance({ theme, text }: { theme: Theme; text: TextSize }) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.text = text;
}

export function saveAppearance(value: { theme: Theme; text: TextSize }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
  applyAppearance(value);
}

/** Runs before first paint (inline in <head>); must match applyAppearance. */
export const APPEARANCE_SCRIPT = `try{var a=JSON.parse(localStorage.getItem("${KEY}")||"{}"),h=document.documentElement;if(a.theme==="dark"||(a.theme!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))h.classList.add("dark");if(a.text==="large"||a.text==="larger")h.dataset.text=a.text}catch(e){}`;
