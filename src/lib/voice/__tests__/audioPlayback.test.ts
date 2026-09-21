import { describe, expect, it, vi } from "vitest";
import { type CreatePlaybackDeps, createPlayback } from "../audioPlayback";

interface FakeAudioBuffer {
  duration: number;
  getChannelData: (channel: number) => Float32Array;
}

class FakeAudioBufferSourceNode {
  buffer: FakeAudioBuffer | null = null;
  connect = vi.fn();
  start = vi.fn();
}

class FakeAudioContext {
  state: "running" | "suspended" | "closed";
  currentTime = 0;
  destination = {};
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  createBuffer: ReturnType<typeof vi.fn>;
  createBufferSource: ReturnType<typeof vi.fn>;

  constructor(initialState: "running" | "suspended" = "running") {
    this.state = initialState;
    this.resume = vi.fn(async () => {
      this.state = "running";
    });
    this.close = vi.fn(async () => {
      this.state = "closed";
    });
    this.createBuffer = vi.fn(
      (_channels: number, length: number, sampleRate: number) => {
        const data = new Float32Array(length);
        return {
          duration: length / sampleRate,
          getChannelData: () => data,
        } satisfies FakeAudioBuffer;
      },
    );
    this.createBufferSource = vi.fn(() => new FakeAudioBufferSourceNode());
  }
}

/**
 * vi.fn() forwards to its implementation as-is; an arrow-function
 * implementation cannot be invoked via `new` (production code does
 * `new AudioContextCtor(...)`). Wrap constructor-mock implementations in a
 * plain `function` so `new` works.
 */
function makeCtorMock<T>(impl: () => T): ReturnType<typeof vi.fn> {
  return vi.fn(function ctorMock() {
    return impl();
  });
}

function makeDeps(ctx: FakeAudioContext): Partial<CreatePlaybackDeps> {
  return {
    AudioContext: makeCtorMock(
      () => ctx,
    ) as unknown as CreatePlaybackDeps["AudioContext"],
  };
}

const flushMicrotasks = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

function int16Frame(values: number[]): ArrayBuffer {
  const arr = new Int16Array(values);
  return arr.buffer;
}

describe("createPlayback — PCM16 to AudioBuffer conversion", () => {
  it("converts Int16 samples to Float32 by dividing by 0x8000 (byte-for-byte)", () => {
    const ctx = new FakeAudioContext();
    const playback = createPlayback(makeDeps(ctx));

    const samples = [0, 0x7fff, -0x8000, -1000, 1000];
    playback.play(int16Frame(samples));

    const created = ctx.createBuffer.mock.results[0].value as FakeAudioBuffer;
    const channelData = created.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      expect(channelData[i]).toBeCloseTo(samples[i] / 0x8000, 10);
    }
  });
});

describe("createPlayback — sequential scheduling", () => {
  it("schedules frames back-to-back, advancing playHead by each buffer's duration", () => {
    const ctx = new FakeAudioContext();
    const playback = createPlayback(makeDeps(ctx));

    playback.play(int16Frame([1, 2, 3, 4])); // length 4 -> duration 4/24000
    playback.play(int16Frame([5, 6])); // length 2 -> duration 2/24000

    const firstNode = ctx.createBufferSource.mock.results[0]
      .value as FakeAudioBufferSourceNode;
    const secondNode = ctx.createBufferSource.mock.results[1]
      .value as FakeAudioBufferSourceNode;

    const firstStart = firstNode.start.mock.calls[0][0] as number;
    const secondStart = secondNode.start.mock.calls[0][0] as number;

    expect(firstStart).toBeCloseTo(0, 10);
    expect(secondStart).toBeCloseTo(4 / 24000, 10);
    expect(secondStart).toBeGreaterThan(firstStart);
  });
});

describe("createPlayback — clear()", () => {
  it("closes the current context and lazily rebuilds a new one on next play()", () => {
    const ctx1 = new FakeAudioContext();
    const ctx2 = new FakeAudioContext();
    let callCount = 0;
    const AudioContextCtor = vi.fn(function ctorMock() {
      callCount += 1;
      return callCount === 1 ? ctx1 : ctx2;
    });
    const playback = createPlayback({
      AudioContext:
        AudioContextCtor as unknown as CreatePlaybackDeps["AudioContext"],
    });

    playback.play(int16Frame([1, 2]));
    playback.clear();

    expect(ctx1.close).toHaveBeenCalledTimes(1);

    playback.play(int16Frame([3, 4]));

    expect(AudioContextCtor).toHaveBeenCalledTimes(2);
    expect(ctx2.createBufferSource).toHaveBeenCalledTimes(1);
  });
});

describe("createPlayback — blocked/resume contract", () => {
  it("fires onBlocked when the lazily-rebuilt context stays suspended after an internal resume attempt", async () => {
    const ctx = new FakeAudioContext("suspended");
    // Internal resume attempt resolves but does not actually unblock (no user gesture).
    ctx.resume.mockImplementation(async () => {
      /* state intentionally left suspended */
    });
    const playback = createPlayback(makeDeps(ctx));
    const onBlocked = vi.fn();
    playback.onBlocked(onBlocked);

    playback.play(int16Frame([1, 2]));
    await flushMicrotasks();

    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it("does not fire onBlocked when the context is running", async () => {
    const ctx = new FakeAudioContext("running");
    const playback = createPlayback(makeDeps(ctx));
    const onBlocked = vi.fn();
    playback.onBlocked(onBlocked);

    playback.play(int16Frame([1, 2]));
    await flushMicrotasks();

    expect(onBlocked).not.toHaveBeenCalled();
  });

  it("resume() resolves true once the context actually becomes running", async () => {
    const ctx = new FakeAudioContext("suspended");
    ctx.resume.mockImplementation(async () => {
      ctx.state = "running";
    });
    const playback = createPlayback(makeDeps(ctx));

    playback.play(int16Frame([1, 2]));
    await flushMicrotasks();

    await expect(playback.resume()).resolves.toBe(true);
  });

  it("resume() resolves false when resume() rejects", async () => {
    const ctx = new FakeAudioContext("suspended");
    ctx.resume.mockRejectedValue(new Error("resume blocked"));
    const playback = createPlayback(makeDeps(ctx));

    playback.play(int16Frame([1, 2]));
    await flushMicrotasks();

    await expect(playback.resume()).resolves.toBe(false);
  });

  it("resume() resolves false when it resolves but the context remains suspended", async () => {
    const ctx = new FakeAudioContext("suspended");
    ctx.resume.mockImplementation(async () => {
      /* still suspended */
    });
    const playback = createPlayback(makeDeps(ctx));

    playback.play(int16Frame([1, 2]));
    await flushMicrotasks();

    await expect(playback.resume()).resolves.toBe(false);
  });

  it("still schedules frames that arrive while blocked (never dropped)", async () => {
    const ctx = new FakeAudioContext("suspended");
    ctx.resume.mockImplementation(async () => {
      /* still suspended */
    });
    const playback = createPlayback(makeDeps(ctx));
    playback.onBlocked(vi.fn());

    playback.play(int16Frame([1, 2]));
    await flushMicrotasks();
    playback.play(int16Frame([3, 4]));

    expect(ctx.createBufferSource).toHaveBeenCalledTimes(2);
    expect(
      ctx.createBufferSource.mock.results[0].value.start,
    ).toHaveBeenCalledTimes(1);
    expect(
      ctx.createBufferSource.mock.results[1].value.start,
    ).toHaveBeenCalledTimes(1);
  });
});

describe("createPlayback — dispose()", () => {
  it("closes the context as a terminal action; play() after dispose() schedules nothing", () => {
    const ctx = new FakeAudioContext();
    const playback = createPlayback(makeDeps(ctx));

    playback.play(int16Frame([1, 2]));
    playback.dispose();

    expect(ctx.close).toHaveBeenCalledTimes(1);

    playback.play(int16Frame([3, 4]));
    expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: calling dispose() twice does not close twice", () => {
    const ctx = new FakeAudioContext();
    const playback = createPlayback(makeDeps(ctx));

    playback.play(int16Frame([1, 2]));
    playback.dispose();
    playback.dispose();

    expect(ctx.close).toHaveBeenCalledTimes(1);
  });
});

describe("createPlayback — setMuted()", () => {
  it("when muted, play() does not schedule audio, and setMuted(true) clears active context", () => {
    const ctx = new FakeAudioContext();
    const playback = createPlayback(makeDeps(ctx));

    playback.play(int16Frame([1, 2]));
    expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);

    playback.setMuted(true);
    // setMuted(true) calls clear(), closing active context
    expect(ctx.close).toHaveBeenCalledTimes(1);

    // Further play calls while muted do not schedule
    playback.play(int16Frame([3, 4]));
    expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);

    // Unmuting allows scheduling new audio
    playback.setMuted(false);

    const ctx2 = new FakeAudioContext();
    const playback2 = createPlayback(makeDeps(ctx2));
    playback2.setMuted(false);
    playback2.play(int16Frame([5, 6]));
    expect(ctx2.createBufferSource).toHaveBeenCalledTimes(1);
  });
});
