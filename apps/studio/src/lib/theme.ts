// The Studio color theme: follow the system by default, or a choice the person
// made in Settings, kept per browser in localStorage. A small script in the
// document head applies it before the first paint, so a dark-mode reader never
// sees a light flash. Pure and DOM-free so the Node tests can run it.

/** The localStorage key that holds the person's choice. */
export const THEME_STORAGE_KEY = "toony-theme";

export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

/** A stored value as a choice. Anything unknown means "follow the system". */
export function readThemeChoice(raw: string | null | undefined): ThemeChoice {
  return raw === "light" || raw === "dark" ? raw : "system";
}

/** The theme to show for a choice, given whether the system prefers dark. */
export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): ResolvedTheme {
  if (choice === "light" || choice === "dark") return choice;
  return systemPrefersDark ? "dark" : "light";
}

/**
 * The inline head script. It sets `data-theme` on <html> from the stored choice
 * (or the system preference) and keeps following the system while no choice is
 * stored. Storage that throws counts as no choice.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,k=${JSON.stringify(
  THEME_STORAGE_KEY,
)},m=window.matchMedia("(prefers-color-scheme: dark)");var c=function(){var s=null;try{s=localStorage.getItem(k)}catch(e){}return s==="light"||s==="dark"?s:"system"};var a=function(){var v=c();d.dataset.theme=v==="system"?(m.matches?"dark":"light"):v;d.dataset.themeChoice=v};a();m.addEventListener("change",a);window.addEventListener("storage",function(e){if(e.key===k)a()})}catch(e){}})();`;
