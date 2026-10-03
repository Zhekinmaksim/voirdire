# Voirdire — design system

**Base:** Hyperstudio, "blueprint scratched into obsidian", from the Refero
Styles library —
<https://styles.refero.design/style/8eb9c53e-d69c-497a-b640-610856cf3a60>

**On top of it:** a metal-and-thin-film layer, written for this project.

## Why these two together

Metal reads on dark, so the base had to be a dark system rather than the
machinist's-blueprint white one this page used before. Hyperstudio supplies the
discipline: obsidian canvas, hairline structure, weight 400 at every size, no
drop shadows anywhere. Without that discipline a metallic page turns into chrome
soup within about twenty minutes.

The iridescence is not decoration and is not free-floating. Iridescence is thin
film interference: one surface returning a different colour depending on the
angle you look from. That is the project's subject stated in optics. Two model
families can look identical under one probe class and separate under another,
and whether you can tell them apart depends entirely on how many angles you
have. So the page spends its spectrum in exactly one place.

## Tokens, taken verbatim from the base

| token | value | role |
| --- | --- | --- |
| `--obsidian` | `#101010` | page canvas |
| `--carbon` | `#080808` | panel surface, footer band |
| `--chalk` | `#f3f3f3` | primary text |
| `--smoke` | `#9c9c9c` | secondary text, captions |
| `--ash` | `#c1c1c1` | body copy inside panels |
| `--graphite` | `#212121` | every hairline: dividers, table rules, tag borders |
| `--iron` | `#474747` | secondary strokes, step numerals |
| `--signal` | `#ffffff` | the single filled pill, used only for the active filter |
| `--gold` | `#6f6759` | reserved; currently only the live-provenance dot |

Type: Aeonik, substitutes Satoshi / General Sans / Inter. **Weight 400 at every
size, including the display** — the base system forbids bold, and scale plus
tracking carry the hierarchy instead. Mono is Input, substitutes IBM Plex Mono /
JetBrains Mono, at `-0.022em` tracking, used for numbers, probe ids, verdict
names and step numerals.

Radius 4px on tags, 8px on cards, pill only on the one filled button. Section
gaps 120px. Content column 1200px, prose capped at 66 characters. No drop
shadows anywhere on the page.

## The added layer

**Brushed steel.** Panels get a bright top edge, a dark belly and a faint return
at the bottom (`--steel`), plus a 1px vertical grain at about 1.4% opacity. That
top-edge-to-belly falloff is the whole trick that makes a flat fill read as
metal; without it the same gradient reads as a plastic card.

**Bevelled borders.** Panels use a two-layer background with `padding-box` and
`border-box` clipping so the 1px edge is itself a gradient, light at the top and
dark at the bottom. This replaces the base system's flat `#212121` border on
panels only. Section rules and table hairlines stay flat `#212121`, because a
bevel on a structural line would read as a mistake.

**The film.** One spectrum, defined once as `--film`, reused everywhere
interference is shown so the page never invents a second rainbow. It appears in
exactly four places: the cell of a pair the battery could not separate, the
border of the disclaimer, the border of a "blind on N pairs" tag, and the
provenance dot while the numbers are synthetic.

**One motion.** A single specular pass across the wordmark on load, plus a slow
drift of the film where it appears. Nothing animates on hover. Both are dropped
entirely under `prefers-reduced-motion`.

## The rule the page is built on

**Colour marks only what the instrument could not resolve.** Everything the
battery separates is rendered in steel, with brightness carrying magnitude: a
cell's top highlight scales with its separation value, so the grid is legible as
a field before any number is read. The pairs it cannot separate are the only
colour on the page.

This inverts the usual dashboard, where success is highlighted and failure is
grey. Here the limit is the finding. It also matches the base system's own rule
that the canvas never takes a coloured fill behind text — the spectral cell is
data, not chrome.

## Departures from the base, and why

**Display type runs to 88px, not 63px.** The base system's display size assumes
a page carried by whitespace. This one is argument-dense, and the wordmark is
the only place boldness is spent, so it needed the extra scale. Weight stays 400.

**Panels carry a gradient surface.** The base system is strictly flat. Metal is
not flat, and a flat metal is just a grey box. The compensation is that no panel
casts a shadow, which is the base rule that actually mattered.

**Compass Gold is nearly unused.** The base reserves it for icon strokes; this
page has no icons, so it survives only on the live-provenance dot. Rather than
invent a use for it, it is left idle.

## Failure modes handled on purpose

- The metal wordmark is declared as plain chalk first and upgraded to a clipped
  gradient inside an `@supports` block. An engine that cannot clip a gradient to
  glyphs would otherwise render the wordmark invisible.
- The spectral cell sets a solid light `background-color` before the gradient.
  Its text is dark, so a cell that failed to paint the gradient would be dark on
  dark and unreadable.
- Every `clamp()` font size is preceded by a static fallback, because an engine
  without `clamp()` drops the whole declaration and collapses the heading.
- Each script block runs inside a `guard`, so one failure cannot blank every
  section below it.
- A grain layer sits over the canvas at 32% opacity. Large dark gradients band
  visibly on 8-bit panels without it.

## The opening screen

The hero has to fit one screen, so the composition is two columns: the wordmark,
the lede and the disclaimer stack in the left, and the interference figure fills
the right beside them. Stacking the disclaimer full-width under both cost a
whole block of height and left the right column empty below the figure.

The provenance caveat is not a hero element. It is a standing statement about
every number on the page, so it sits in a slim strip directly under the
masthead, above the fold and above the argument, where it reads as a condition
on the whole document rather than as one more card.

Two things the first real-browser screenshot caught that no earlier check could:

- The specular pass parks at `translateX(120%)` under `animation-fill-mode:
  both`, and with nothing clipping it, it sat beside the wordmark as a permanent
  white slash. `.sheen` now clips its own overflow, with a little horizontal
  padding so the negative tracking does not shave the glyph edges.
- The figure's caption was placed below the last plate but outside the
  `viewBox`, which clips regardless of the element's CSS height. The viewBox and
  the mask rect were extended to hold it.

## The corpus rows

Twenty-one probes stacked as open cards made the page a scroll, so the corpus is
a list of collapsed rows built on native `<details>` and `<summary>`. Native
rather than scripted, because the browser gives keyboard operation, the correct
roles, and the open state for free, and because the rows still read as a full
list on an engine that does not implement `details` at all.

Each closed row carries what a reader scans by: the probe id in mono, its class
and run count, the spectral tag if the probe is blind on any pair, and the
opening of the carrier task cut with an ellipsis. The carrier preview is set to
`visibility:hidden` rather than removed when a row opens, so the summary keeps
its height and the rows below do not jump.

The chevron is a rotated 9px corner drawn from two borders rather than an icon,
since the base system has no icon set. Its rotation is the one transition on the
page, and it answers the reader's own click rather than announcing itself.

One bevelled plate wraps the whole list and the rows are divided by hairlines.
Twenty-one individually bevelled panels read as noise; in this system the line
is the layout.

## Where numbering is allowed

One numbered list, for the six steps of a round. That sequence is genuinely
ordered — commit strictly before send, send strictly before reveal — and getting
the order wrong is the failure the whole mechanism exists to prevent. Nothing
else on the page is numbered.
