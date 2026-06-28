// Prepends Vite's base URL so asset paths work on GitHub Pages (/poke-web/)
// as well as in local dev (/).
const base = import.meta.env.BASE_URL;
export const assetUrl = (path) => base + path.replace(/^\//, "");
