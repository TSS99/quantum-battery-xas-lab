'use client';
/**
 * The live oscilloscope of the results dock: the amplifier outputs of the three ion chambers swept across the screen,
 * ten readings a second at the mono's current energy, the way a beamline scope shows them while the operator works.
 * Every reading is a live-feed sample (src/lib/twin/live-feed.ts), so a change to any control shows up on the trace at
 * once. It draws on a canvas outside React's render, and stops while it is off screen or the tab is hidden.
 */
import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { Tex } from '../tex';
import { seededRandom } from '@/lib/xas';
import { LIVE_DWELL_S, LIVE_WINDOW_S, liveSample, scopeTop, type LiveSample } from '@/lib/twin/live-feed';
import type { TwinMode, TwinState } from '@/lib/twin/types';

const CHANNELS = [
  { key: 'i0_V', id: 'i0', tex: 'I_0', color: '#7fd8cf' },
  { key: 'it_V', id: 'it', tex: 'I_t', color: '#ffc46b' },
  { key: 'iref_V', id: 'iref', tex: String.raw`I_\mathrm{ref}`, color: '#b49cff' },
] as const;
const FLUOR_MODES: readonly TwinMode[] = ['fluorescence', 'xrf'];
/** Seconds of trace blanked just ahead of the sweep, as on a real scope, so the old sweep and the new one do not meet. */
const GAP_S = 0.35;

export function LiveScope({ twin }: { twin: TwinState }) {
  const canvas = useRef<HTMLCanvasElement>(null), values = useRef<HTMLDListElement>(null), warning = useRef<HTMLParagraphElement>(null);
  const reduced = !!useReducedMotion();
  // The loop reads the latest state each tick without restarting.
  const state = useRef(twin);
  useEffect(() => { state.current = twin; });

  useEffect(() => {
    const el = canvas.current, list = values.current; if (!el || !list) return;
    const ctx = el.getContext('2d'); if (!ctx) return;
    const random = seededRandom(Math.floor(Math.random() * 2 ** 31));
    const samples: LiveSample[] = [];
    const start = performance.now();
    let taken = 0, top = 1, frame = 0, visible = true, lastText = 0, lastDraw = 0;

    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = el.clientWidth, h = el.clientHeight;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) { el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w, h };
    };

    const text = (now_s: number) => {
      // The numbers are the mean of the last half second, so realistic noise stays readable.
      const recent = samples.filter(s => s.t > now_s - 0.5); if (!recent.length) return;
      const mean = (k: keyof LiveSample) => recent.reduce((a, s) => a + (s[k] as number), 0) / recent.length;
      const [i0, it, iref, cps] = [mean('i0_V'), mean('it_V'), mean('iref_V'), mean('if_cps')];
      const put = (key: string, value: string) => { const cell = list.querySelector(`[data-v="${key}"]`); if (cell) cell.textContent = value; };
      put('i0', i0.toFixed(3) + ' V'); put('it', it.toFixed(3) + ' V'); put('iref', iref.toFixed(3) + ' V');
      put('if', cps >= 1e3 ? (cps / 1e3).toFixed(cps >= 1e5 ? 0 : 1) + ' k/s' : cps.toFixed(0) + ' /s');
      put('mu', it > 0 && i0 > 0 ? Math.log(i0 / it).toFixed(3) : '–');
      const clipped = samples.at(-1)!.saturated;
      if (warning.current) { warning.current.hidden = !clipped.length; warning.current.textContent = clipped.length ? `${clipped.join(', ')} clipped at full scale: lower the gain.` : ''; }
    };

    const draw = (now_s: number) => {
      const { w, h } = fit(), pad = { l: 34, r: 8, t: 8, b: 18 }, pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
      const shown = samples.filter(s => s.t > now_s - LIVE_WINDOW_S + GAP_S);
      const max = Math.max(...shown.flatMap(s => CHANNELS.map(c => s[c.key])), 0);
      // The axis eases to its new range rather than jumping.
      const want = scopeTop(max); top += (want - top) * (reduced ? 1 : 0.15);
      ctx.clearRect(0, 0, w, h);
      ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.fillStyle = 'rgba(167,177,193,.85)'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = pad.t + ph * (1 - i / 4);
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
        ctx.fillText((top * i / 4).toFixed(top < 0.5 ? 3 : top < 5 ? 2 : 1), pad.l - 4, y);
      }
      for (let i = 0; i <= LIVE_WINDOW_S; i++) { const x = pad.l + pw * i / LIVE_WINDOW_S; ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke(); }
      ctx.textAlign = 'left'; ctx.fillText('1 s / div', pad.l, h - 7);
      const xOf = (t: number) => pad.l + pw * ((t % LIVE_WINDOW_S) / LIVE_WINDOW_S), yOf = (v: number) => pad.t + ph * (1 - Math.min(v, top) / top);
      const head = xOf(now_s);
      for (const c of CHANNELS) {
        ctx.strokeStyle = c.color; ctx.lineWidth = 1.6; ctx.beginPath();
        let prevX = -1;
        for (const s of shown) {
          const x = xOf(s.t), y = yOf(s[c.key]);
          if (prevX < 0 || x < prevX) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          prevX = x;
        }
        // The newest reading is held up to the sweep, so the trace grows smoothly between readings.
        const last = shown.at(-1);
        if (last && head >= prevX) ctx.lineTo(head, yOf(last[c.key]));
        ctx.stroke();
        if (last && !reduced) { ctx.fillStyle = c.color; ctx.shadowColor = c.color; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(head, yOf(last[c.key]), 2.6, 0, 2 * Math.PI); ctx.fill(); ctx.shadowBlur = 0; }
      }
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (!visible || document.hidden) return;
      const now_s = (now - start) / 1000;
      // Catch up on the readings due since the last frame, but never more than a second's worth after a pause.
      if (now_s - taken * LIVE_DWELL_S > 1) taken = Math.floor(now_s / LIVE_DWELL_S) - 10;
      while ((taken + 1) * LIVE_DWELL_S <= now_s) { taken++; samples.push(liveSample(state.current, taken * LIVE_DWELL_S, random)); }
      while (samples.length && samples[0].t < now_s - LIVE_WINDOW_S) samples.shift();
      // With reduced motion the scope redraws twice a second instead of sweeping smoothly.
      if (!reduced || now - lastDraw > 500) { draw(now_s); lastDraw = now; }
      if (now - lastText > 250) { text(now_s); lastText = now; }
    };
    frame = requestAnimationFrame(tick);

    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    observer?.observe(el);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [reduced]);

  return <figure className="twin-scope">
    <figcaption>
      <span><span className="twin-scope-live">Live</span> at {twin.energy_eV.toFixed(1)} eV, ten readings a second{twin.realistic ? ', with counting noise' : ''}</span>
      <dl ref={values} className="twin-scope-values">
        {CHANNELS.map(c => <div key={c.key}><dt><i style={{ background: c.color }} aria-hidden="true" /><Tex plain>{c.tex}</Tex></dt><dd data-v={c.id}>–</dd></div>)}
        {/* The fluorescence detector counts in the fluorescence modes only. */}
        {FLUOR_MODES.includes(twin.mode) && <div><dt><Tex plain>{'I_f'}</Tex></dt><dd data-v="if">–</dd></div>}
        <div><dt><Tex plain>{String.raw`\ln(I_0/I_t)`}</Tex></dt><dd data-v="mu">–</dd></div>
      </dl>
    </figcaption>
    <canvas ref={canvas} role="img" aria-label={`Oscilloscope: the I0, It and Iref amplifier outputs over the last ${LIVE_WINDOW_S} seconds, redrawn as they are read.`} />
    <p ref={warning} className="twin-warning" role="alert" hidden />
  </figure>;
}
