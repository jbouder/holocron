import { useEffect, useSyncExternalStore } from 'react';
import { alertTitle, parseTimerSound } from '@/lib/timer-alert-text';

/**
 * What happens on this device when the shared timer reaches zero: a short
 * Web Audio chime (if the Timer sound preference is on) and a title change
 * so a background tab shows it. Nothing here touches the board.
 */

const STORAGE_KEY = 'holocron:timer-sound';

// ---- Preference -------------------------------------------------------------

const listeners = new Set<() => void>();

function readTimerSound(): boolean {
  try {
    return parseTimerSound(localStorage.getItem(STORAGE_KEY));
  } catch {
    return true;
  }
}

let soundOn = readTimerSound();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function setTimerSound(on: boolean) {
  soundOn = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Private mode: the choice lasts for this page load.
  }
  for (const l of listeners) l();
}

export function useTimerSound(): boolean {
  return useSyncExternalStore(subscribe, () => soundOn);
}

// ---- Audio ------------------------------------------------------------------

/**
 * Created on the first pointer or key press, never before: browsers refuse
 * (and warn about) audio that starts without a user gesture. Creating it
 * inside the gesture also unlocks it for later, when the tab may be hidden.
 */
let audio: AudioContext | null = null;

function unlock() {
  if (audio || typeof AudioContext === 'undefined') return;
  try {
    audio = new AudioContext();
    void audio.resume();
  } catch {
    audio = null;
  }
}

/** Arm the audio unlock while a board is open. */
export function useAudioUnlock() {
  useEffect(() => {
    if (audio) return;
    const events = ['pointerdown', 'keydown'] as const;
    const handler = () => {
      unlock();
      if (audio) for (const e of events) window.removeEventListener(e, handler);
    };
    for (const e of events) window.addEventListener(e, handler);
    return () => {
      for (const e of events) window.removeEventListener(e, handler);
    };
  }, []);
}

/** Two soft sine notes, about 0.6s in all. No-op until audio is unlocked. */
export function playChime(): boolean {
  if (!audio || audio.state === 'closed') return false;
  void audio.resume();
  const start = audio.currentTime + 0.02;
  for (const [i, freq] of [880, 1318.5].entries()) {
    const t = start + i * 0.18;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // A quick attack and an exponential tail, so it doesn't click.
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.42);
  }
  return true;
}

// ---- Title ------------------------------------------------------------------

/**
 * Show the alert in the tab title until the tab is visible and focused,
 * then put the original back. Returns a cleanup that restores it early.
 */
export function flashTitle(animate: boolean): () => void {
  const original = document.title;
  let tick = 0;
  let interval: number | undefined;
  let timeout: number | undefined;
  let stopped = false;

  const focused = () =>
    document.visibilityState === 'visible' && document.hasFocus();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(interval);
    window.clearTimeout(timeout);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onFocus);
    document.title = original;
  };
  const onFocus = () => {
    if (focused()) stop();
  };

  // Seen already: the in-page pulse is enough, but hold the title briefly
  // so it isn't a no-op for someone glancing at the tab strip.
  document.title = alertTitle(original, tick, animate);
  if (focused()) {
    timeout = window.setTimeout(stop, 3000);
    return stop;
  }
  if (animate) {
    interval = window.setInterval(() => {
      tick += 1;
      document.title = alertTitle(original, tick, animate);
    }, 1000);
  }
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
  return stop;
}
