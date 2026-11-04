export const THEME_STORAGE_KEY = "ft-theme";

/**
 * Runs synchronously in <head> before first paint. Resolves the stored
 * preference ("light" | "dark" | "system") to data-theme on <html>.
 * Keep it dependency-free and tiny.
 */
export const themeInitScript = `(function(){try{var s=localStorage.getItem("${THEME_STORAGE_KEY}");var d=s==="dark"||(s!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.setAttribute("data-theme",d?"dark":"light");r.style.colorScheme=d?"dark":"light"}catch(e){}})()`;
