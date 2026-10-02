import { flushSync } from 'react-dom';

/**
 * The platform-only motion helpers this app uses. No animation library:
 * View Transitions, the Web Animations API, and CSS `linear()` easings baked
 * from a damped-spring integrator. Every helper takes `enabled` so the
 * header switch (and prefers-reduced-motion) can turn it into a plain cut.
 */

/* ---------- View Transitions ---------- */

/**
 * Run a React state update inside a view transition, or just run it.
 *
 * `type` lands on `<html data-vt="…">` for the life of the transition so the
 * stylesheet can scope `view-transition-name`s: the list only gets its own
 * snapshot during a filter change, the page only during navigation.
 */
export function withViewTransition(
  update: () => void,
  enabled: boolean,
  type = 'default',
) {
  if (!enabled || typeof document.startViewTransition !== 'function') {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.vt = type;
  const transition = document.startViewTransition(() => {
    flushSync(update);
  });
  // A skipped transition (hidden tab, another one in flight) rejects these;
  // the DOM update has still happened, so there is nothing to handle.
  transition.ready.catch(() => undefined);
  transition.finished
    .catch(() => undefined)
    .then(() => {
      if (root.dataset.vt === type) {
        delete root.dataset.vt;
      }
    });
}

/* ---------- Web Animations API ---------- */

export const EASE_EMPHASIZED = 'cubic-bezier(0.2, 0, 0, 1)';

/** Animate an element out, resolving when done (immediately when disabled). */
export function animateOut(el: HTMLElement, enabled: boolean): Promise<void> {
  if (!enabled) {
    return Promise.resolve();
  }
  const animation = el.animate(
    [
      { opacity: 1, translate: '0 0', scale: '1' },
      { opacity: 0, translate: '24px 0', scale: '0.98' },
    ],
    { duration: 200, easing: EASE_EMPHASIZED, fill: 'forwards' },
  );
  return animation.finished.then(() => undefined);
}

/* ---------- Springs baked into linear() ---------- */

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass?: number;
}

const STEP_S = 1 / 120;
const REST_DELTA = 0.001;
const REST_SPEED = 0.001;
const MAX_DURATION_S = 10;

/** Semi-implicit Euler on a unit spring (0 → 1). */
export function simulateSpring(config: SpringConfig): {
  samples: number[];
  durationMs: number;
} {
  const { stiffness, damping, mass = 1 } = config;
  let position = 0;
  let velocity = 0;
  const samples = [0];

  for (let t = STEP_S; t <= MAX_DURATION_S; t += STEP_S) {
    const acceleration =
      (-stiffness * (position - 1) - damping * velocity) / mass;
    velocity += acceleration * STEP_S;
    position += velocity * STEP_S;
    samples.push(position);
    if (
      Math.abs(position - 1) < REST_DELTA &&
      Math.abs(velocity) < REST_SPEED
    ) {
      break;
    }
  }
  samples[samples.length - 1] = 1;
  return { samples, durationMs: (samples.length - 1) * STEP_S * 1000 };
}

/** Bake a spring into a CSS `linear(...)` string plus its natural duration. */
export function springLinearEasing(config: SpringConfig): {
  easing: string;
  durationMs: number;
} {
  const { samples, durationMs } = simulateSpring(config);
  const stride = Math.max(1, Math.ceil(samples.length / 60));
  const stops: string[] = [];
  for (let i = 0; i < samples.length; i += stride) {
    const progress = ((i / (samples.length - 1)) * 100).toFixed(1);
    stops.push(`${samples[i].toFixed(4)} ${progress}%`);
  }
  if ((samples.length - 1) % stride !== 0) {
    stops.push('1 100%');
  }
  return { easing: `linear(${stops.join(', ')})`, durationMs };
}

export const SPRING_PRESETS = {
  snappy: { stiffness: 260, damping: 24 },
  bouncy: { stiffness: 300, damping: 12 },
} as const satisfies Record<string, SpringConfig>;

/** Write `--ease-spring-*` and `--ease-spring-*-duration` onto :root once. */
export function installSpringEasingTokens(
  root: HTMLElement = document.documentElement,
) {
  for (const [name, config] of Object.entries(SPRING_PRESETS)) {
    const { easing, durationMs } = springLinearEasing(config);
    root.style.setProperty(`--ease-spring-${name}`, easing);
    root.style.setProperty(
      `--ease-spring-${name}-duration`,
      `${Math.round(durationMs)}ms`,
    );
  }
}
