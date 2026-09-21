/**
 * Downstream 24k PCM16 playback queue for the voice feature.
 *
 * Ported from the backend reference implementation `poc-client.html`
 * (`playPcm24` / `clearPlayback`). See plan
 * `memory/reviews/plans/c53da5fe11faa273.md` §4 / §5.10.
 *
 * The playback `AudioContext` is created lazily on first `play()` (or after a
 * `clear()`), and `playHead` is advanced sequentially so frames are scheduled
 * back-to-back regardless of arrival timing. `clear()` closes and discards the
 * whole context (interrupted / any close path); the next frame lazily
 * rebuilds it. If the rebuilt context ends up `"suspended"` and an internal
 * `resume()` attempt does not clear that state, `onBlocked` fires so the UI
 * can offer a "tap to continue" affordance; frames that arrive while blocked
 * are still scheduled (never dropped) so they play once the context resumes.
 */

export interface CreatePlaybackDeps {
  AudioContext: new (contextOptions?: AudioContextOptions) => AudioContext;
}

export interface Playback {
  play(frame: ArrayBuffer): void;
  clear(): void;
  dispose(): void;
  resume(): Promise<boolean>;
  onBlocked(cb: () => void): void;
  setMuted(muted: boolean): void;
}

const OUT_RATE = 24000;

function resolveDeps(deps: Partial<CreatePlaybackDeps>): CreatePlaybackDeps {
  return {
    AudioContext: deps.AudioContext ?? AudioContext,
  };
}

export function createPlayback(
  deps: Partial<CreatePlaybackDeps> = {},
): Playback {
  const { AudioContext: AudioContextCtor } = resolveDeps(deps);

  let context: AudioContext | null = null;
  let playHead = 0;
  let disposed = false;
  let muted = false;
  let blockedCallback: (() => void) | null = null;

  const notifyIfBlocked = (ctx: AudioContext): void => {
    if (ctx.state !== "suspended") return;
    Promise.resolve()
      .then(() => ctx.resume())
      .catch(() => {
        // resume() rejecting is itself a "still blocked" signal; the state
        // check below is what actually decides whether to notify.
      })
      .then(() => {
        if (context === ctx && ctx.state === "suspended") {
          blockedCallback?.();
        }
      });
  };

  const ensureContext = (): AudioContext => {
    if (context) return context;
    const ctx = new AudioContextCtor({ sampleRate: OUT_RATE });
    context = ctx;
    playHead = ctx.currentTime;
    notifyIfBlocked(ctx);
    return ctx;
  };

  const play = (frame: ArrayBuffer): void => {
    if (disposed || muted) return;
    const ctx = ensureContext();
    const view = new Int16Array(frame);
    const floatData = new Float32Array(view.length);
    for (let i = 0; i < view.length; i++) {
      floatData[i] = view[i] / 0x8000;
    }
    const audioBuffer = ctx.createBuffer(1, floatData.length, OUT_RATE);
    audioBuffer.getChannelData(0).set(floatData);
    const node = ctx.createBufferSource();
    node.buffer = audioBuffer;
    node.connect(ctx.destination);
    const now = ctx.currentTime;
    if (playHead < now) playHead = now;
    node.start(playHead);
    playHead += audioBuffer.duration;
  };

  const clear = (): void => {
    if (context) {
      try {
        void context.close();
      } catch {
        // ignore: best-effort release
      }
      context = null;
    }
    playHead = 0;
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    clear();
    blockedCallback = null;
  };

  const resume = async (): Promise<boolean> => {
    if (!context) return false;
    try {
      await context.resume();
    } catch {
      return false;
    }
    return context.state === "running";
  };

  const onBlocked = (cb: () => void): void => {
    blockedCallback = cb;
  };

  const setMuted = (nextMuted: boolean): void => {
    muted = nextMuted;
    if (muted) {
      clear();
    }
  };

  return { play, clear, dispose, resume, onBlocked, setMuted };
}
