import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PrototypeAudio, type PrototypeLoopNote } from "./prototype-audio";

// PROTOTYPE — Three creation-surface variants, switchable via ?variant=, in a disposable standalone app.

type VariantKey = "A" | "B" | "C";
type VoiceStatus = "empty" | "armed" | "playing" | "muted" | "recording";
type MidiStatus = "idle" | "requesting" | "connected" | "disconnected" | "unavailable" | "error";

interface Voice {
  readonly id: number;
  readonly pad: number;
  readonly name: string;
  readonly role: string;
  readonly color: string;
  readonly bars: number;
  readonly status: VoiceStatus;
  readonly pattern: readonly number[];
}

interface PrototypeState {
  readonly title: string;
  readonly tempo: number;
  readonly beat: number;
  readonly playing: boolean;
  readonly selectedVoice: number;
  readonly activeMoment: number;
  readonly note: string | null;
  readonly intensity: number;
  readonly captureRemaining: number | null;
  readonly voices: readonly Voice[];
}

interface MidiConnection {
  readonly status: MidiStatus;
  readonly detail: string;
}

interface CapturedNote extends PrototypeLoopNote {
  readonly key: number;
}

interface OpenCapturedNote {
  readonly key: number;
  readonly note: number;
  readonly startSeconds: number;
  readonly velocity: number;
}

interface ActiveCapture {
  readonly voice: number;
  readonly startedAt: number;
  readonly notes: CapturedNote[];
  readonly openNotes: Map<number, OpenCapturedNote>;
  readonly finishTimer: ReturnType<typeof globalThis.setTimeout>;
  readonly progressTimer: ReturnType<typeof globalThis.setInterval>;
}

const variantNames: Record<VariantKey, string> = {
  A: "Cells + Moments",
  B: "Layer Tape",
  C: "Performance Arc",
};

const voiceSeed: readonly Voice[] = [
  { id: 0, pad: 1, name: "Low Tide", role: "Beat", color: "coral", bars: 1, status: "empty", pattern: [] },
  { id: 1, pad: 2, name: "Salt Hats", role: "Pulse", color: "gold", bars: 1, status: "empty", pattern: [] },
  { id: 2, pad: 3, name: "Sub Current", role: "Bass", color: "mint", bars: 1, status: "empty", pattern: [] },
  { id: 3, pad: 4, name: "Glass Air", role: "Chords", color: "cyan", bars: 1, status: "empty", pattern: [] },
  { id: 4, pad: 5, name: "Soft Knock", role: "Perc", color: "violet", bars: 1, status: "empty", pattern: [] },
  { id: 5, pad: 6, name: "Night Tape", role: "Texture", color: "blue", bars: 1, status: "empty", pattern: [] },
  { id: 6, pad: 7, name: "Neon Thread", role: "Lead", color: "pink", bars: 1, status: "empty", pattern: [] },
  { id: 7, pad: 8, name: "Open Space", role: "Wild", color: "lime", bars: 1, status: "empty", pattern: [] },
];

// Match the physical C25: pads 5–8 are the top row and 1–4 are the bottom row.
const c25PadDisplayOrder = [5, 6, 7, 8, 1, 2, 3, 4] as const;

const initialState: PrototypeState = {
  title: "New music sketch",
  tempo: 112,
  beat: 0,
  playing: false,
  selectedVoice: 0,
  activeMoment: 0,
  note: null,
  intensity: 0,
  captureRemaining: null,
  voices: voiceSeed,
};

const blackPitchClasses = new Set([1, 3, 6, 8, 10]);
const noteNames = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] as const;
const keys = Array.from({ length: 25 }, (_, index) => {
  const note = 48 + index;
  const pitchClass = note % 12;
  return {
    black: blackPitchClasses.has(pitchClass),
    label: `${noteNames[pitchClass] ?? "?"}${Math.floor(note / 12) - 1}`,
    note,
  };
});

const loopSeconds = (60 / initialState.tempo) * 4;

function notePattern(notes: readonly CapturedNote[]) {
  const pattern = Array.from({ length: 8 }, () => 0);
  for (const note of notes) {
    const index = Math.min(7, Math.floor((note.startSeconds / loopSeconds) * 8));
    pattern[index] = Math.max(pattern[index] ?? 0, note.velocity / 127);
  }
  return pattern;
}

function midiNoteName(note: number) {
  const pitchClass = note % 12;
  return `${noteNames[pitchClass] ?? "?"}${Math.floor(note / 12) - 1}`;
}

function useSketchState() {
  const [state, setState] = useState<PrototypeState>(initialState);
  const [midi, setMidi] = useState<MidiConnection>({ status: "idle", detail: "Enable the C25 to play" });
  const stateRef = useRef<PrototypeState>(initialState);
  const audioRef = useRef<PrototypeAudio | null>(null);
  const captureRef = useRef<ActiveCapture | null>(null);
  const midiAccessRef = useRef<MIDIAccess | null>(null);

  const updateState = useCallback((update: (current: PrototypeState) => PrototypeState) => {
    const next = update(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, []);

  const getAudio = useCallback(() => {
    audioRef.current ??= new PrototypeAudio();
    return audioRef.current;
  }, []);

  useEffect(() => {
    if (!state.playing) return;
    const timer = globalThis.setInterval(() => {
      updateState((current) => ({ ...current, beat: (current.beat + 1) % 32 }));
    }, 60_000 / state.tempo);
    return () => globalThis.clearInterval(timer);
  }, [state.playing, state.tempo, updateState]);

  const finishCapture = useCallback(() => {
    const capture = captureRef.current;
    if (!capture) return;

    globalThis.clearTimeout(capture.finishTimer);
    globalThis.clearInterval(capture.progressTimer);
    const stoppedAt = Math.min(loopSeconds, performance.now() / 1000 - capture.startedAt);
    for (const open of capture.openNotes.values()) {
      capture.notes.push({
        durationSeconds: Math.max(0.06, stoppedAt - open.startSeconds),
        key: open.key,
        note: open.note,
        startSeconds: open.startSeconds,
        velocity: open.velocity,
      });
    }

    captureRef.current = null;
    getAudio().setRunning(true);
    getAudio().startLoop(capture.voice, capture.notes, loopSeconds);
    updateState((current) => ({
      ...current,
      beat: 0,
      captureRemaining: null,
      playing: true,
      voices: current.voices.map((voice) =>
        voice.id === capture.voice
          ? { ...voice, pattern: notePattern(capture.notes), status: "playing" }
          : voice,
      ),
    }));
  }, [getAudio, updateState]);

  const beginCapture = useCallback((voice: number, now: number) => {
    const finishTimer = globalThis.setTimeout(finishCapture, loopSeconds * 1000);
    const progressTimer = globalThis.setInterval(() => {
      const remaining = Math.max(0, 1 - (performance.now() / 1000 - now) / loopSeconds);
      updateState((current) => ({ ...current, captureRemaining: remaining }));
    }, 80);

    captureRef.current = {
      finishTimer,
      notes: [],
      openNotes: new Map(),
      progressTimer,
      startedAt: now,
      voice,
    };
    getAudio().setRunning(true);
    updateState((current) => ({
      ...current,
      beat: 0,
      captureRemaining: 1,
      playing: true,
      voices: current.voices.map((candidate) =>
        candidate.id === voice ? { ...candidate, status: "recording" } : candidate,
      ),
    }));
  }, [finishCapture, getAudio, updateState]);

  const closeCapturedNote = useCallback((note: number) => {
    const capture = captureRef.current;
    const open = capture?.openNotes.get(note);
    if (!capture || !open) return;

    const stoppedAt = Math.min(loopSeconds, performance.now() / 1000 - capture.startedAt);
    capture.notes.push({
      durationSeconds: Math.max(0.06, stoppedAt - open.startSeconds),
      key: open.key,
      note: open.note,
      startSeconds: open.startSeconds,
      velocity: open.velocity,
    });
    capture.openNotes.delete(note);
  }, []);

  const keyDown = useCallback((note: number, velocity = 96) => {
    const now = performance.now() / 1000;
    const selected = stateRef.current.voices[stateRef.current.selectedVoice];
    if (!selected) return;

    if (selected.status === "armed") beginCapture(selected.id, now);
    closeCapturedNote(note);
    const capture = captureRef.current;
    if (capture) {
      capture.openNotes.set(note, {
        key: note,
        note,
        startSeconds: Math.max(0, now - capture.startedAt),
        velocity,
      });
    }

    getAudio().noteOn(note, velocity, selected.id);
    updateState((current) => ({
      ...current,
      intensity: Math.round((velocity / 127) * 100),
      note: midiNoteName(note),
    }));
  }, [beginCapture, closeCapturedNote, getAudio, updateState]);

  const keyUp = useCallback((note: number) => {
    closeCapturedNote(note);
    getAudio().noteOff(note);
    updateState((current) => ({ ...current, note: null }));
  }, [closeCapturedNote, getAudio, updateState]);

  const pressPad = useCallback((index: number) => {
    const voice = stateRef.current.voices[index];
    if (!voice) return;

    if (voice.status === "recording") {
      finishCapture();
      return;
    }
    if (captureRef.current) return;

    if (voice.status === "playing") getAudio().setLoopMuted(voice.id, true);
    if (voice.status === "muted") getAudio().setLoopMuted(voice.id, false);

    updateState((current) => ({
      ...current,
      selectedVoice: index,
      voices: current.voices.map((candidate) => {
        if (candidate.id !== index) {
          return candidate.status === "armed" ? { ...candidate, status: "empty" } : candidate;
        }
        if (candidate.status === "empty") return { ...candidate, status: "armed" };
        if (candidate.status === "armed") return { ...candidate, status: "empty" };
        if (candidate.status === "playing") return { ...candidate, status: "muted" };
        if (candidate.status === "muted") return { ...candidate, status: "playing" };
        return candidate;
      }),
    }));
  }, [finishCapture, getAudio, updateState]);

  const setMoment = useCallback((moment: number) => {
    updateState((current) => ({ ...current, activeMoment: moment }));
  }, [updateState]);

  const setIntensity = useCallback((intensity: number) => {
    updateState((current) => ({ ...current, intensity }));
  }, [updateState]);

  const togglePlaying = useCallback(() => {
    const playing = !stateRef.current.playing;
    void getAudio().enable();
    getAudio().setRunning(playing);
    updateState((current) => ({ ...current, playing }));
  }, [getAudio, updateState]);

  const stop = useCallback(() => {
    getAudio().setRunning(false);
    updateState((current) => ({ ...current, beat: 0, playing: false }));
  }, [getAudio, updateState]);

  const undo = useCallback(() => {
    const selectedVoice = stateRef.current.selectedVoice;
    const capture = captureRef.current;
    if (capture?.voice === selectedVoice) {
      globalThis.clearTimeout(capture.finishTimer);
      globalThis.clearInterval(capture.progressTimer);
      captureRef.current = null;
    }
    getAudio().clearLoop(selectedVoice);
    updateState((current) => ({
      ...current,
      captureRemaining: null,
      voices: current.voices.map((voice) =>
        voice.id === current.selectedVoice ? { ...voice, status: "empty", pattern: [] } : voice,
      ),
    }));
  }, [getAudio, updateState]);

  const attachC25Inputs = useCallback((access: MIDIAccess) => {
    for (const input of access.inputs.values()) input.onmidimessage = null;
    const inputs = Array.from(access.inputs.values()).filter((input) =>
      input.state === "connected" && input.name?.includes("C25mini USB MIDI"),
    );

    for (const input of inputs) {
      input.onmidimessage = (event) => {
        const data = event.data;
        if (!data) return;
        const status = data[0] ?? 0;
        const data1 = data[1] ?? 0;
        const data2 = data[2] ?? 0;
        if (status === 0xf8) return;

        const command = status & 0xf0;
        const channel = status & 0x0f;
        if (channel === 0 && command === 0x90 && data2 > 0) keyDown(data1, data2);
        if (channel === 0 && (command === 0x80 || (command === 0x90 && data2 === 0))) keyUp(data1);
        if (channel === 9 && command === 0x90 && data2 > 0 && data1 >= 44 && data1 <= 51) pressPad(data1 - 44);
        if (channel === 9 && command === 0xa0) setIntensity(Math.round((data2 / 127) * 100));
      };
    }

    setMidi(inputs.length > 0
      ? { status: "connected", detail: inputs[0]?.name ?? "C25 connected" }
      : { status: "disconnected", detail: "C25 USB MIDI is not connected" });
  }, [keyDown, keyUp, pressPad, setIntensity]);

  const enableC25 = useCallback(async () => {
    setMidi({ status: "requesting", detail: "Waiting for MIDI permission…" });
    try {
      await getAudio().enable();
      if (!("requestMIDIAccess" in navigator)) {
        setMidi({ status: "unavailable", detail: "This browser has no Web MIDI; the on-screen keys still work" });
        return;
      }

      const access = await navigator.requestMIDIAccess({ sysex: false });
      midiAccessRef.current = access;
      access.onstatechange = () => attachC25Inputs(access);
      attachC25Inputs(access);
    } catch (error) {
      setMidi({
        status: "error",
        detail: error instanceof Error ? error.message : "MIDI permission was not granted",
      });
    }
  }, [attachC25Inputs, getAudio]);

  useEffect(() => () => {
    const access = midiAccessRef.current;
    if (access) {
      access.onstatechange = null;
      for (const input of access.inputs.values()) input.onmidimessage = null;
    }
    const capture = captureRef.current;
    if (capture) {
      globalThis.clearTimeout(capture.finishTimer);
      globalThis.clearInterval(capture.progressTimer);
    }
    audioRef.current?.dispose();
    audioRef.current = null;
  }, []);

  return { enableC25, keyDown, keyUp, midi, pressPad, setMoment, setIntensity, state, stop, togglePlaying, undo };
}

interface VariantProps {
  readonly state: PrototypeState;
  readonly pressPad: (index: number) => void;
  readonly setMoment: (moment: number) => void;
}

function AppHeader({
  midi,
  onEnableC25,
  state,
}: {
  readonly midi: MidiConnection;
  readonly onEnableC25: () => void;
  readonly state: PrototypeState;
}) {
  const connected = midi.status === "connected";
  const requesting = midi.status === "requesting";
  return (
    <header className="app-header">
      <div>
        <span className="eyebrow">C25 Loop sketcher · prototype</span>
        <h1>{state.title}</h1>
      </div>
      <div className="transport-readout" aria-label="Transport state">
        <span className={`connection-dot ${connected ? "is-live" : ""}`} />
        <strong>{state.playing ? "Playing" : "Ready"}</strong>
        <span>{state.tempo} BPM</span>
        <span>{Math.floor(state.beat / 4) + 1}.{(state.beat % 4) + 1}</span>
        <button
          className={`device-pill status-${midi.status}`}
          disabled={connected || requesting}
          onClick={onEnableC25}
          title={midi.detail}
          type="button"
        >
          {connected ? "C25 connected" : requesting ? "Connecting…" : "Enable C25 + audio"}
        </button>
      </div>
    </header>
  );
}

function StateRibbon({ state, variant }: { readonly state: PrototypeState; readonly variant: VariantKey }) {
  const active = state.voices.filter((voice) => voice.status === "playing" || voice.status === "muted" || voice.status === "recording").length;
  const armed = state.voices.find((voice) => voice.status === "armed");
  const recording = state.voices.find((voice) => voice.status === "recording");
  const capture = recording
    ? `Recording · ${Math.max(0, (state.captureRemaining ?? 0) * loopSeconds).toFixed(1)}s`
    : armed
      ? `Pad ${armed.pad} armed`
      : "Ready";
  return (
    <div className="state-ribbon" aria-label="Full prototype state">
      <span><i>Surface</i>{variantNames[variant]}</span>
      <span><i>Voices</i>{active} of 8</span>
      <span><i>Selected</i>Pad {state.selectedVoice + 1} · {state.voices[state.selectedVoice]?.role}</span>
      <span><i>Capture</i>{capture}</span>
      <span><i>Moment</i>{state.activeMoment + 1}</span>
      <span><i>Last key</i>{state.note ?? "—"}</span>
      <span><i>Energy</i>{state.intensity}%</span>
    </div>
  );
}

function Pattern({ pattern }: { readonly pattern: readonly number[] }) {
  if (pattern.length === 0) return <span className="empty-pattern">ready to capture</span>;
  return (
    <span className="pattern" aria-hidden="true">
      {pattern.map((height, index) => <i key={index} style={{ height: `${Math.max(12, height * 100)}%` }} />)}
    </span>
  );
}

function VariantA({ state, pressPad, setMoment }: VariantProps) {
  const moments = ["Opening", "Settle in", "All together", "Air out"];
  const selected = state.voices[state.selectedVoice];
  const coach = selected?.status === "armed"
    ? { title: "Play a one-bar phrase", body: "Your first key starts capture. Keep playing until the ring completes." }
    : selected?.status === "recording"
      ? { title: "Keep playing", body: "The phrase will loop automatically at the end of this bar." }
      : selected?.status === "playing"
        ? { title: `${selected.role} is looping`, body: `Tap pad ${selected.pad} to mute it, or choose an empty pad for another layer.` }
        : selected?.status === "muted"
          ? { title: `${selected.role} is resting`, body: `Tap pad ${selected.pad} to bring its loop back.` }
          : { title: "Choose your first sound", body: "Press an empty C25 pad, then play a phrase on the keys." };
  return (
    <main className="variant variant-a">
      <section className="variant-intro">
        <div><span className="variant-kicker">A · Cells + Moments</span><h2>Fill the pads. Save the feeling.</h2></div>
        <p>Each physical pad owns one loop. A Moment remembers which loops are heard together.</p>
      </section>
      <section className="cell-stage">
        <div className="cell-grid">
          {state.voices.map((voice) => (
            <button
              className={`loop-cell color-${voice.color} status-${voice.status} ${state.selectedVoice === voice.id ? "is-selected" : ""}`}
              key={voice.id}
              onClick={() => pressPad(voice.id)}
              type="button"
            >
              <span className="cell-number">PAD {voice.pad}</span>
              <span className="cell-role">{voice.role}</span>
              <strong>{voice.status === "empty" ? "+ Capture" : voice.status === "armed" ? "Play the keys" : voice.name}</strong>
              <Pattern pattern={voice.pattern} />
              <span className="cell-meta">{voice.status} · {voice.bars} bars</span>
            </button>
          ))}
        </div>
        <aside className="cell-coach">
          <span className="coach-step">NOW</span>
          <strong>{coach.title}</strong>
          <p>{coach.body}</p>
          <div className={`beat-ring ${selected?.status === "recording" ? "is-recording" : ""}`}>
            <span>{selected?.status === "recording" ? Math.ceil((state.captureRemaining ?? 0) * 4) : (state.beat % 4) + 1}</span>
            <small>{selected?.status === "recording" ? "beats left" : "beat"}</small>
          </div>
        </aside>
      </section>
      <section className="moments">
        <div className="section-heading"><span>Your story</span><button type="button">+ Save this as a Moment</button></div>
        <div className="moment-strip">
          {moments.map((moment, index) => (
            <button className={state.activeMoment === index ? "is-active" : ""} key={moment} onClick={() => setMoment(index)} type="button">
              <span>0:{index * 16 || "00"}</span><strong>{moment}</strong><small>{index === 0 ? "Beat" : index === 1 ? "Beat · Bass" : index === 2 ? "4 voices" : "Bass · Air"}</small>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

function VariantB({ state, pressPad }: VariantProps) {
  return (
    <main className="variant variant-b">
      <section className="tape-topline">
        <div><span className="variant-kicker">B · Layer Tape</span><h2>Build down. Arrange across.</h2></div>
        <div className="tape-guide"><b>1</b> Add a layer <span>→</span><b>2</b> Place entrances <span>→</span><b>3</b> Play the sketch</div>
      </section>
      <section className="tape-workspace">
        <aside className="role-shelf">
          <span className="shelf-label">NEXT LAYER</span>
          <strong>{state.voices[state.selectedVoice]?.role}</strong>
          <p>Play on the keys. Recording begins on the next bar.</p>
          <button className="primary-action" type="button">● Capture 4 bars</button>
          <button className="quiet-action" type="button">Change sound</button>
          <div className="small-meter"><span style={{ width: `${state.intensity}%` }} /></div>
        </aside>
        <div className="tape-board">
          <div className="tape-ruler"><span>START</span><span>0:16</span><span>0:32</span><span>0:48</span><span>1:04</span></div>
          <div className="playhead" style={{ left: `${17 + (state.beat / 32) * 78}%` }} />
          {state.voices.slice(0, 6).map((voice, index) => (
            <button className={`tape-lane color-${voice.color} ${state.selectedVoice === voice.id ? "is-selected" : ""}`} key={voice.id} onClick={() => pressPad(voice.id)} type="button">
              <span className="lane-label"><i>{voice.pad}</i><span><b>{voice.role}</b><small>{voice.status}</small></span></span>
              <span className="lane-timeline">
                {voice.status === "empty" ? <em>Click or press pad {voice.pad} to capture</em> : (
                  <>
                    <i className="lane-block block-one"><Pattern pattern={voice.pattern} /></i>
                    <i className="lane-block block-two"><Pattern pattern={voice.pattern} /></i>
                    {index < 4 ? <i className="lane-block block-three"><Pattern pattern={voice.pattern} /></i> : null}
                  </>
                )}
              </span>
              <span className="lane-control">{voice.status === "muted" ? "Bring in" : "Mute"}</span>
            </button>
          ))}
          <button className="add-lane" type="button">+ Add another musical role</button>
        </div>
      </section>
    </main>
  );
}

function VariantC({ state, pressPad }: VariantProps) {
  const activeVoices = state.voices.filter((voice) => voice.status !== "empty");
  return (
    <main className="variant variant-c">
      <section className="arc-heading">
        <span className="variant-kicker">C · Performance Arc</span>
        <h2>Make the loop. Then perform its journey.</h2>
        <p>No arrangement grid: the final sketch is the changes you perform while Story capture is running.</p>
      </section>
      <section className="arc-workspace">
        <aside className="arc-library">
          <span className="shelf-label">YOUR SOUNDS</span>
          {state.voices.map((voice) => (
            <button className={`arc-sound color-${voice.color} ${state.selectedVoice === voice.id ? "is-selected" : ""}`} key={voice.id} onClick={() => pressPad(voice.id)} type="button">
              <i>{voice.pad}</i><span><b>{voice.role}</b><small>{voice.status}</small></span><em>{voice.status === "empty" ? "+" : "●"}</em>
            </button>
          ))}
        </aside>
        <div className="orbit-stage">
          <div className="orbit orbit-outer" />
          <div className="orbit orbit-middle" />
          <div className="orbit orbit-inner" />
          {activeVoices.map((voice, index) => {
            const angle = (index / activeVoices.length) * Math.PI * 2 - Math.PI / 2;
            const x = 50 + Math.cos(angle) * 38;
            const y = 50 + Math.sin(angle) * 38;
            return (
              <button className={`orbit-node color-${voice.color} status-${voice.status}`} key={voice.id} onClick={() => pressPad(voice.id)} style={{ left: `${x}%`, top: `${y}%` }} type="button">
                <span>{voice.pad}</span><strong>{voice.role}</strong><small>{voice.status}</small>
              </button>
            );
          })}
          <button className="arc-core" type="button">
            <span className="arc-pulse" />
            <strong>{state.playing ? "LIVE LOOP" : "READY"}</strong>
            <b>{Math.floor(state.beat / 4) + 1}.{(state.beat % 4) + 1}</b>
            <small>{activeVoices.length} voices moving</small>
          </button>
        </div>
        <aside className="story-capture">
          <span className="shelf-label">STORY CAPTURE</span>
          <div className="story-time"><strong>0:38</strong><span>of 1:12</span></div>
          <div className="story-wave">
            {Array.from({ length: 28 }, (_, index) => <i key={index} style={{ height: `${18 + ((index * 17) % 70)}%` }} />)}
          </div>
          <ol>
            <li className="is-past"><i />Beat alone <span>0:00</span></li>
            <li className="is-past"><i />Bass entered <span>0:09</span></li>
            <li className="is-current"><i />Chords lifted <span>0:31</span></li>
            <li><i />Keep performing… <span>now</span></li>
          </ol>
          <button className="finish-story" type="button">■ Finish the journey</button>
        </aside>
      </section>
    </main>
  );
}

interface C25DockProps {
  readonly state: PrototypeState;
  readonly pressPad: (index: number) => void;
  readonly keyDown: (note: number, velocity?: number) => void;
  readonly keyUp: (note: number) => void;
  readonly setIntensity: (intensity: number) => void;
  readonly togglePlaying: () => void;
  readonly stop: () => void;
  readonly undo: () => void;
}

function C25Dock({ state, pressPad, keyDown, keyUp, setIntensity, togglePlaying, stop, undo }: C25DockProps) {
  return (
    <section className="c25-dock" aria-label="On-screen C25 fallback">
      <div className="c25-label"><span>C25</span><small>ON-SCREEN FALLBACK</small></div>
      <div className="touch-strips"><button type="button"><span>PITCH</span></button><button type="button"><span>MOD</span></button></div>
      <div className="knob-bank">
        {state.voices.map((voice, index) => (
          <button aria-label={`${voice.role} intensity`} key={voice.id} onClick={() => setIntensity(Math.min(100, 32 + index * 9))} type="button">
            <i style={{ transform: `rotate(${-125 + (index * 31)}deg)` }} /><small>{index + 1}</small>
          </button>
        ))}
      </div>
      <div className="mini-pads">
        {c25PadDisplayOrder.map((pad) => {
          const voice = state.voices.find((candidate) => candidate.pad === pad);
          if (!voice) return null;
          return <button aria-label={`Pad ${voice.pad}: ${voice.role}`} className={`color-${voice.color} status-${voice.status}`} key={voice.id} onClick={() => pressPad(voice.id)} type="button">{voice.pad}</button>;
        })}
      </div>
      <div className="mini-keys">
        {keys.map((key) => (
          <button
            aria-label={key.label}
            className={`${key.black ? "is-black" : ""} ${state.note === key.label ? "is-down" : ""}`}
            key={key.note}
            onPointerCancel={() => keyUp(key.note)}
            onPointerDown={() => keyDown(key.note)}
            onPointerLeave={() => keyUp(key.note)}
            onPointerUp={() => keyUp(key.note)}
            type="button"
          >
            <span>{key.note % 12 === 0 ? key.label : ""}</span>
          </button>
        ))}
      </div>
      <div className="mini-transport">
        <button onClick={undo} title="Undo" type="button">↶</button>
        <button title="Loop" type="button">↻</button>
        <button className="record-button" title="Record" type="button">●</button>
        <button onClick={togglePlaying} title={state.playing ? "Pause" : "Play"} type="button">{state.playing ? "Ⅱ" : "▶"}</button>
        <button onClick={stop} title="Stop" type="button">■</button>
      </div>
    </section>
  );
}

function readVariant(): VariantKey {
  const value = new URLSearchParams(globalThis.location.search).get("variant")?.toUpperCase();
  return value === "B" || value === "C" ? value : "A";
}

function PrototypeSwitcher({ current, onChange }: { readonly current: VariantKey; readonly onChange: (variant: VariantKey) => void }) {
  const variants: readonly VariantKey[] = ["A", "B", "C"];
  const cycle = useCallback((direction: -1 | 1) => {
    const currentIndex = variants.indexOf(current);
    const nextIndex = (currentIndex + direction + variants.length) % variants.length;
    onChange(variants[nextIndex] ?? "A");
  }, [current, onChange, variants]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.matches("input, textarea, [contenteditable=true]") || target.closest("input, textarea, [contenteditable=true]"))) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [cycle]);

  if (process.env.NODE_ENV === "production") return null;

  return (
    <nav className="prototype-switcher" aria-label="Prototype variant switcher">
      <button aria-label="Previous variant" onClick={() => cycle(-1)} type="button">←</button>
      <span><small>THROWAWAY PROTOTYPE</small><strong>{current} — {variantNames[current]}</strong></span>
      <button aria-label="Next variant" onClick={() => cycle(1)} type="button">→</button>
    </nav>
  );
}

export function CreationSurfacePrototype() {
  const [variant, setVariant] = useState<VariantKey>(readVariant);
  const sketch = useSketchState();

  const changeVariant = useCallback((next: VariantKey) => {
    const url = new URL(globalThis.location.href);
    url.searchParams.set("variant", next);
    globalThis.history.replaceState({}, "", url);
    setVariant(next);
  }, []);

  const content = useMemo(() => {
    const props = { state: sketch.state, pressPad: sketch.pressPad, setMoment: sketch.setMoment };
    if (variant === "B") return <VariantB {...props} />;
    if (variant === "C") return <VariantC {...props} />;
    return <VariantA {...props} />;
  }, [sketch.pressPad, sketch.setMoment, sketch.state, variant]);

  return (
    <div className={`prototype-shell surface-${variant.toLowerCase()}`}>
      <AppHeader midi={sketch.midi} onEnableC25={sketch.enableC25} state={sketch.state} />
      <StateRibbon state={sketch.state} variant={variant} />
      {content}
      <C25Dock
        keyDown={sketch.keyDown}
        keyUp={sketch.keyUp}
        pressPad={sketch.pressPad}
        setIntensity={sketch.setIntensity}
        state={sketch.state}
        stop={sketch.stop}
        togglePlaying={sketch.togglePlaying}
        undo={sketch.undo}
      />
      <PrototypeSwitcher current={variant} onChange={changeVariant} />
    </div>
  );
}
