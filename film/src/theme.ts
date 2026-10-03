/**
 * Same tokens as the site (design/DESIGN.md): Hyperstudio "blueprint scratched
 * into obsidian" from Refero Styles, plus this project's metal and thin-film
 * layer.
 *
 * The one rule carries over unchanged and governs the whole video: colour marks
 * only what the instrument could not resolve. Everything the battery separates
 * is steel. The spectrum appears in exactly one scene.
 */

export const C = {
  obsidian: '#101010',
  carbon: '#080808',
  chalk: '#f3f3f3',
  ash: '#c1c1c1',
  smoke: '#9c9c9c',
  graphite: '#212121',
  iron: '#474747',
  signal: '#ffffff',
  gold: '#6f6759',
} as const;

export const SANS =
  "'Geist','Inter','Satoshi','General Sans',system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
export const MONO =
  "'Geist Mono','IBM Plex Mono','JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace";

/** One spectrum, defined once, reused wherever interference is shown. */
export const FILM =
  'linear-gradient(100deg,#7fd8ff 0%,#9ea8ff 18%,#d59bff 34%,#ff9ec4 50%,#ffcf8f 66%,#b9f2c4 82%,#7fd8ff 100%)';

/** Bright top edge, dark belly, faint return. The falloff is what makes a flat
 *  fill read as metal rather than as a plastic card. */
export const STEEL =
  'linear-gradient(180deg,rgba(255,255,255,.085) 0%,rgba(255,255,255,.022) 18%,rgba(0,0,0,.30) 62%,rgba(255,255,255,.030) 100%)';

export const EDGE =
  'linear-gradient(180deg,rgba(255,255,255,.20),rgba(255,255,255,.03) 40%,rgba(0,0,0,.55))';

export const METAL_TEXT =
  'linear-gradient(178deg,#ffffff 0%,#cfd4da 26%,#7c848d 46%,#eef1f4 56%,#9aa2ab 72%,#5d646c 100%)';

/** Safe margins for 1920x1080. */
export const PAD = 128;
