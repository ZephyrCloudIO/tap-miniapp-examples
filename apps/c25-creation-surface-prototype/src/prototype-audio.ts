export interface PrototypeLoopNote {
  readonly note: number;
  readonly velocity: number;
  readonly startSeconds: number;
  readonly durationSeconds: number;
}

interface PlayingNote {
  readonly gain: GainNode;
  readonly oscillator: OscillatorNode;
}

interface LoopPlayback {
  muted: boolean;
  nextCycleAt: number;
  readonly notes: readonly PrototypeLoopNote[];
  readonly timer: ReturnType<typeof globalThis.setTimeout>;
}

const waveforms: readonly OscillatorType[] = [
  "sine",
  "triangle",
  "sawtooth",
  "square",
  "triangle",
  "sine",
  "sawtooth",
  "square",
];

function noteFrequency(note: number) {
  return 440 * 2 ** ((note - 69) / 12);
}

export class PrototypeAudio {
  private context: AudioContext | null = null;
  private liveNotes = new Map<number, PlayingNote>();
  private loops = new Map<number, LoopPlayback>();
  private running = false;

  async enable() {
    const context = this.getContext();
    if (context.state !== "running") await context.resume();
  }

  noteOn(note: number, velocity: number, voice: number) {
    const context = this.getContext();
    void context.resume();
    this.noteOff(note);

    const now = context.currentTime;
    const playing = this.createNote(note, velocity, voice, now);
    this.liveNotes.set(note, playing);
  }

  noteOff(note: number) {
    const playing = this.liveNotes.get(note);
    const context = this.context;
    if (!playing || !context) return;

    const now = context.currentTime;
    playing.gain.gain.cancelScheduledValues(now);
    playing.gain.gain.setTargetAtTime(0.0001, now, 0.025);
    playing.oscillator.stop(now + 0.16);
    this.liveNotes.delete(note);
  }

  setRunning(running: boolean) {
    this.running = running;
  }

  startLoop(voice: number, notes: readonly PrototypeLoopNote[], loopSeconds: number) {
    this.clearLoop(voice);
    const context = this.getContext();

    const scheduleCycle = () => {
      const playback = this.loops.get(voice);
      if (!playback) return;

      while (playback.nextCycleAt < context.currentTime + 0.02) {
        playback.nextCycleAt += loopSeconds;
      }

      if (this.running && !playback.muted) {
        for (const note of playback.notes) {
          this.scheduleNote(
            note.note,
            note.velocity,
            voice,
            playback.nextCycleAt + note.startSeconds,
            note.durationSeconds,
          );
        }
      }

      playback.nextCycleAt += loopSeconds;
      const delay = Math.max(20, (playback.nextCycleAt - context.currentTime - 0.05) * 1000);
      const nextTimer = globalThis.setTimeout(scheduleCycle, delay);
      this.loops.set(voice, { ...playback, timer: nextTimer });
    };

    const timer = globalThis.setTimeout(scheduleCycle, 0);
    this.loops.set(voice, {
      muted: false,
      nextCycleAt: context.currentTime + 0.08,
      notes,
      timer,
    });
  }

  setLoopMuted(voice: number, muted: boolean) {
    const playback = this.loops.get(voice);
    if (playback) playback.muted = muted;
  }

  clearLoop(voice: number) {
    const playback = this.loops.get(voice);
    if (!playback) return;
    globalThis.clearTimeout(playback.timer);
    this.loops.delete(voice);
  }

  dispose() {
    for (const voice of this.loops.keys()) this.clearLoop(voice);
    for (const note of this.liveNotes.keys()) this.noteOff(note);
    void this.context?.close();
    this.context = null;
  }

  private getContext() {
    this.context ??= new AudioContext({ latencyHint: "interactive" });
    return this.context;
  }

  private createNote(note: number, velocity: number, voice: number, startAt: number) {
    const context = this.getContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const level = Math.max(0.025, (velocity / 127) * 0.14);

    oscillator.type = waveforms[voice % waveforms.length] ?? "triangle";
    oscillator.frequency.setValueAtTime(noteFrequency(note), startAt);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900 + voice * 260, startAt);
    filter.Q.setValueAtTime(0.7, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(level, startAt + 0.012);

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);

    return { gain, oscillator };
  }

  private scheduleNote(note: number, velocity: number, voice: number, startAt: number, durationSeconds: number) {
    const playing = this.createNote(note, velocity, voice, startAt);
    const releaseAt = startAt + Math.max(0.06, durationSeconds);
    playing.gain.gain.setTargetAtTime(0.0001, releaseAt, 0.025);
    playing.oscillator.stop(releaseAt + 0.16);
  }
}
