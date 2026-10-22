/*
 * Homepage product-video slot.
 *
 * Set `src` to a PassWisely-owned recording or AI-generated video served from
 * this site (for example `/media/passwisely-demo.mp4` under `public/media/`).
 * While `src` is null the section is not rendered, so production never shows
 * an empty player or third-party footage.
 */
export const DEMO_VIDEO: Readonly<{
  src: string | null;
  poster: string | null;
  durationLabel: string | null;
}> = Object.freeze({
  src: null,
  poster: null,
  durationLabel: null,
});
