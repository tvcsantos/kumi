// Fades out the splash screen from index.html once the app has something to show.

/** Long enough for the logo to finish drawing, so a fast start doesn't cut the animation short. */
const MIN_VISIBLE_MS = 1250;

export function dismissSplash() {
  const splash = document.getElementById('splash');
  if (!splash || splash.classList.contains('splash-out')) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = reduceMotion ? 0 : Math.max(0, MIN_VISIBLE_MS - performance.now());
  setTimeout(() => {
    splash.classList.add('splash-out');
    setTimeout(() => splash.remove(), 400);
  }, wait);
}
