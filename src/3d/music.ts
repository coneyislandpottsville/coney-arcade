export type Music = {
  readonly on: boolean;
  readonly playing: boolean;
  toggle(): void;
  setEra(era: string): void;
  start(changed: () => void): () => void;
};

type Voice = { era: string; source: AudioBufferSourceNode; gain: GainNode };

const KEY = "maze3d-music";
const LEVEL = 0.6;
const FADE = 1.6;

export function createMusic(prefix: string, lengths: Record<string, number>): Music {
  let context: AudioContext | null = null;
  let voice: Voice | null = null;
  let era = "1917";
  let on = false;
  let playing = false;
  let armed = false;
  let generation = 0;
  let changed: () => void = () => {};
  let unlisten: (() => void) | null = null;
  const buffers = new Map<string, Promise<AudioBuffer>>();

  const remembered = (): boolean => {
    try {
      return localStorage.getItem(KEY) === "on";
    } catch {
      return false;
    }
  };

  const remember = (value: "on" | null): void => {
    try {
      if (value === null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, value);
    } catch {
      return;
    }
  };

  const load = (which: string): Promise<AudioBuffer> => {
    let pending = buffers.get(which);
    if (!pending) {
      pending = fetch(`${prefix}music-${which}.mp3`)
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status));
          return response.arrayBuffer();
        })
        .then((bytes) => context!.decodeAudioData(bytes));
      pending.catch(() => buffers.delete(which));
      buffers.set(which, pending);
    }
    return pending;
  };

  const release = (old: Voice, now: number, seconds: number): void => {
    old.gain.gain.cancelScheduledValues(now);
    old.gain.gain.setValueAtTime(old.gain.gain.value, now);
    old.gain.gain.linearRampToValueAtTime(0, now + seconds);
    old.source.stop(now + seconds + 0.05);
  };

  const play = async (): Promise<void> => {
    stopListening();
    const turn = ++generation;
    try {
      context ??= new AudioContext();
      if (context.state !== "running") await context.resume();
      const which = era;
      const buffer = await load(which);
      if (turn !== generation || !on) return;
      if (voice?.era === which) return;
      const now = context.currentTime;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(LEVEL, now + FADE);
      gain.connect(context.destination);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopEnd = Math.min(buffer.duration, lengths[which] ?? buffer.duration);
      source.connect(gain);
      source.start(now);
      if (voice) release(voice, now, FADE);
      voice = { era: which, source, gain };
      playing = true;
      armed = false;
      changed();
    } catch {
      if (turn !== generation) return;
      on = false;
      playing = false;
      armed = false;
      changed();
    }
  };

  const stop = (): void => {
    stopListening();
    generation += 1;
    on = false;
    playing = false;
    armed = false;
    if (voice && context) {
      release(voice, context.currentTime, 0.5);
      voice = null;
    }
    remember(null);
    changed();
  };

  function stopListening(): void {
    unlisten?.();
    unlisten = null;
  }

  return {
    get on() {
      return on || armed;
    },
    get playing() {
      return playing;
    },
    toggle() {
      if (on || armed) {
        stop();
        return;
      }
      on = true;
      remember("on");
      changed();
      void play();
    },
    setEra(next) {
      era = next;
      if (on && voice?.era !== next) void play();
    },
    start(onChange) {
      changed = onChange;
      if (!remembered()) return () => {};
      armed = true;
      changed();
      const resume = (event: Event): void => {
        if (event.target instanceof Element && event.target.closest('[data-toggle="music"]')) return;
        on = true;
        void play();
      };
      window.addEventListener("pointerdown", resume, { passive: true });
      window.addEventListener("keydown", resume);
      unlisten = () => {
        window.removeEventListener("pointerdown", resume);
        window.removeEventListener("keydown", resume);
      };
      return () => stopListening();
    },
  };
}
