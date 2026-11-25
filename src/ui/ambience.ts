/**
 * Slowly drifting specks of dust caught in the light. Pure CSS animations of
 * transform/opacity, so they run on the compositor and cost almost nothing.
 */
export function createDustLayer(count = 14): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'dust';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i++) {
    const mote = document.createElement('span');
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    mote.style.setProperty('--x', `${r(4, 96).toFixed(1)}vw`);
    mote.style.setProperty('--y', `${r(10, 105).toFixed(1)}vh`);
    mote.style.setProperty('--size', `${r(1.5, 3.6).toFixed(1)}px`);
    mote.style.setProperty('--drift-x', `${r(-14, 14).toFixed(1)}vw`);
    mote.style.setProperty('--drift-y', `${r(-35, -15).toFixed(1)}vh`);
    mote.style.setProperty('--glow', r(0.25, 0.6).toFixed(2));
    mote.style.animationDuration = `${r(26, 48).toFixed(1)}s`;
    mote.style.animationDelay = `${(-r(0, 48)).toFixed(1)}s`;
    layer.appendChild(mote);
  }
  return layer;
}
