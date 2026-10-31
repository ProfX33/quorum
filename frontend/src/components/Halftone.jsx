import { useEffect, useRef } from 'react';

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Animated halftone: dots of `ink` on `paper`, sized by a slowly drifting field so that
 * blobs of solid ink grow, merge and dissolve. The field swells toward the pointer.
 * Pauses while off screen and draws a single still frame for reduced motion.
 */
export default function Halftone({ className = '', cell = 10, paper = '#E5500E', ink = '#6A5AE6', seed = 0 }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pointer = { x: 0, y: 0, strength: 0, target: 0 };
    let w = 0;
    let h = 0;
    let frame = 0;
    let visible = false;

    const field = (x, y, t) => {
      const u = x / 120 + seed;
      const v = y / 120 - seed;
      const f =
        Math.sin(u * 0.8 + t * 0.55) +
        Math.sin(v * 1.05 - t * 0.4 + Math.sin(u * 0.5 + t * 0.2)) +
        Math.sin((u + v) * 0.6 + t * 0.3) +
        Math.sin(Math.hypot(u - 2.5 - Math.sin(t * 0.17) * 2, v - 1.5 - Math.cos(t * 0.13)) * 1.2 - t * 0.7);
      let value = smoothstep(-1.8, 1.8, f);
      if (pointer.strength > 0.01) {
        const d2 = (x - pointer.x) ** 2 + (y - pointer.y) ** 2;
        value += pointer.strength * 0.9 * Math.exp(-d2 / 14000);
      }
      return Math.min(1, value);
    };

    const draw = (time) => {
      const t = time / 1000;
      pointer.strength += (pointer.target - pointer.strength) * 0.06;
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = ink;
      ctx.beginPath();
      for (let y = cell / 2; y < h + cell; y += cell) {
        for (let x = cell / 2; x < w + cell; x += cell) {
          const r = cell * (0.1 + 0.62 * field(x, y, t));
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      ctx.fill();
    };

    const loop = (time) => {
      if (visible) draw(time);
      frame = requestAnimationFrame(loop);
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(still ? 4000 : performance.now());
    };

    const onPointer = (e) => {
      const box = canvas.getBoundingClientRect();
      pointer.x = e.clientX - box.left;
      pointer.y = e.clientY - box.top;
      const inside = pointer.x > -80 && pointer.y > -80 && pointer.x < box.width + 80 && pointer.y < box.height + 80;
      pointer.target = inside ? 1 : 0;
    };

    const sizes = new ResizeObserver(resize);
    sizes.observe(canvas);
    const onScreen = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
    onScreen.observe(canvas);
    if (!still) {
      frame = requestAnimationFrame(loop);
      window.addEventListener('pointermove', onPointer);
    }
    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      onScreen.disconnect();
      window.removeEventListener('pointermove', onPointer);
    };
  }, [cell, paper, ink, seed]);

  return <canvas ref={ref} aria-hidden className={`block h-full w-full ${className}`} />;
}
