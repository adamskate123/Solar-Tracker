/**
 * Single source of truth for the app version.
 *
 * Shown as a chip in the page header so a deployed site can be checked at a
 * glance: if the badge does not match the version you just shipped, the
 * browser or CDN is still serving an older build (GitHub Pages caches assets
 * for about ten minutes; a hard refresh clears it).
 *
 * Bump VERSION and BUILD_DATE together when releasing.
 */
export const VERSION = '1.4.0';
export const BUILD_DATE = '2026-08-29';
