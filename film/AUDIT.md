# Film audit, 2026-10-03

The original film is a working historical artifact. It is **not current v3
release evidence** and is excluded from the product deployment.

## Technical verification

- `npm run typecheck` passes.
- The complete `Voirdire` composition renders successfully with the installed
  Chrome browser and concurrency 4. No source changes were required.
- Both the supplied MP4 and the fresh render contain H.264 video at 1920×1080,
  30 fps, plus AAC stereo at 48 kHz. The video has 1,800 frames. The container
  duration is 60.053 seconds because of audio encoding padding.
- A contact sheet covering all twelve scenes shows the original metal and
  thin-film design, with no obvious clipping. This is a sampled visual review,
  not a claim that every frame was inspected.
- The fresh MP4 decodes completely without errors. Its decoded audio has a mean
  level of -16.8 dBFS and a peak of -0.5 dBFS; decoded sample peaks do not clip.
- Geist and Geist Mono are absent from the local font directories. Rendering
  succeeds using the fallback stacks; typography is not reproducible across
  machines until the project bundles and explicitly loads its chosen fonts.

The audit render is kept outside the repository; the original
`../voirdire-60s.mp4` is preserved.

## Content that must change before a current launch cut

- The four-family separation matrix is synthetic and explicitly labelled as
  such in the film. It includes Claude and a constructed Llama/Mistral collision.
  The approved v3 profile instead covers three exact model/provider routes.
- The 112-features/48-samples finding and the estimated 2,520-call budget belong
  to the original study. They do not describe the fresh v3 confirmation:
  1,800 responses, 300 complete rounds, 100 rounds per model.
- The status scene says “95 offline checks”, “live battery: not run” and
  “Bradbury: not yet”. Those statements are historical. Current results and
  finalized testnet settlement controls are recorded in `../PRODUCTION_STATUS.md`
  and `../public/release-verification.json`.
- Corpus examples in the film are source probes, not the exact six frozen v3
  probes. A current cut must distinguish those scopes.

A new launch cut should preserve the original design and musical edit while
using the current confirmation counts, abstention limits, trusted collector
boundary and Bradbury testnet wording. The historical film must not be presented
as a measurement or a current product-status report.
