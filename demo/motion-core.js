/* Deterministic DOM-film helpers. Mount actual product UI separately. */
(() => {
  'use strict';
  const clamp = value => Math.max(0, Math.min(1, value));
  const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
  const mix = (from, to, amount) => from + (to - from) * amount;
  const curve = (time, start, duration) => ease((time - start) / duration);
  const point = (element, stage, x = .5, y = .5) => {
    if (!element || !stage) throw new Error('A cursor target and stage are required.');
    const target = element.getBoundingClientRect(), root = stage.getBoundingClientRect();
    return { x: target.left - root.left + target.width * x, y: target.top - root.top + target.height * y };
  };
  const install = ({ durationMs, render, posterMs = durationMs * .75 }) => {
    if (!(durationMs > 0) || typeof render !== 'function') throw new Error('Provide durationMs and a render(ms) function.');
    let frame = null;
    const stop = () => { if (frame !== null) cancelAnimationFrame(frame); frame = null; };
    const draw = ms => render(Math.max(0, Math.min(durationMs - .001, ms)));
    const play = () => {
      stop();
      const start = performance.now();
      const tick = now => { draw((now - start) % durationMs); frame = requestAnimationFrame(tick); };
      frame = requestAnimationFrame(tick);
    };
    const api = { duration: durationMs, posterMs, renderAt(ms) { stop(); return draw(ms); }, play, stop };
    window.caseMotion = api;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const manual = new URLSearchParams(location.search).has('manual');
    draw(reduced.matches ? posterMs : 0);
    if (!manual && !reduced.matches) play();
    reduced.addEventListener('change', event => {
      if (event.matches) api.renderAt(posterMs);
      else if (!manual) play();
    });
    return api;
  };
  window.CaseStudyMotion = Object.freeze({ clamp, ease, mix, curve, point, install });
})();
