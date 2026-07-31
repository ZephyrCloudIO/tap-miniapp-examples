import { useCallback, useEffect, useMemo, useState } from "react";

// PROTOTYPE — Three creation-surface variants, switchable via ?variant=, in a disposable standalone app.

type VariantKey = "A" | "B" | "C";
type VoiceStatus = "empty" | "playing" | "muted" | "recording";

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
  readonly voices: readonly Voice[];
}

const variantNames: Record<VariantKey, string> = {
  A: "Cells + Moments",
  B: "Layer Tape",
  C: "Performance Arc",
};

const voiceSeed: readonly Voice[] = [
  { id: 0, pad: 1, name: "Low Tide", role: "Beat", color: "coral", bars: 2, status: "playing", pattern: [1, 0, 0.55, 0, 0.8, 0, 0.55, 0] },
  { id: 1, pad: 2, name: "Salt Hats", role: "Pulse", color: "gold", bars: 2, status: "playing", pattern: [0.3, 0.8, 0.4, 0.9, 0.3, 0.8, 0.5, 1] },
  { id: 2, pad: 3, name: "Sub Current", role: "Bass", color: "mint", bars: 4, status: "playing", pattern: [0.9, 0.2, 0, 0.5, 0.8, 0, 0.3, 0.6] },
  { id: 3, pad: 4, name: "Glass Air", role: "Chords", color: "cyan", bars: 4, status: "muted", pattern: [0.7, 0.7, 0.2, 0.2, 0.75, 0.75, 0.35, 0.35] },
  { id: 4, pad: 5, name: "Soft Knock", role: "Perc", color: "violet", bars: 2, status: "empty", pattern: [] },
  { id: 5, pad: 6, name: "Night Tape", role: "Texture", color: "blue", bars: 4, status: "empty", pattern: [] },
  { id: 6, pad: 7, name: "Neon Thread", role: "Lead", color: "pink", bars: 4, status: "empty", pattern: [] },
  { id: 7, pad: 8, name: "Open Space", role: "Wild", color: "lime", bars: 8, status: "empty", pattern: [] },
];

// Match the physical C25: pads 5–8 are the top row and 1–4 are the bottom row.
const c25PadDisplayOrder = [5, 6, 7, 8, 1, 2, 3, 4] as const;

const initialState: PrototypeState = {
  title: "After Rain",
  tempo: 112,
  beat: 9,
  playing: true,
  selectedVoice: 3,
  activeMoment: 1,
  note: null,
  intensity: 68,
  voices: voiceSeed,
};

const keys = ["C", "D", "E", "F", "G", "A", "B", "C2", "D2", "E2", "F2", "G2", "A2", "B2", "C3"] as const;

function nextVoiceStatus(status: VoiceStatus): VoiceStatus {
  if (status === "empty") return "recording";
  if (status === "recording") return "playing";
  if (status === "playing") return "muted";
  return "playing";
}

function useSketchState() {
  const [state, setState] = useState<PrototypeState>(initialState);

  useEffect(() => {
    if (!state.playing) return;
    const timer = globalThis.setInterval(() => {
      setState((current) => ({ ...current, beat: (current.beat + 1) % 32 }));
    }, 480);
    return () => globalThis.clearInterval(timer);
  }, [state.playing]);

  const pressPad = useCallback((index: number) => {
    setState((current) => ({
      ...current,
      selectedVoice: index,
      voices: current.voices.map((voice) =>
        voice.id === index ? { ...voice, status: nextVoiceStatus(voice.status) } : voice,
      ),
    }));
  }, []);

  const setMoment = useCallback((moment: number) => {
    setState((current) => ({ ...current, activeMoment: moment }));
  }, []);

  const setNote = useCallback((note: string | null) => {
    setState((current) => ({ ...current, note }));
  }, []);

  const setIntensity = useCallback((intensity: number) => {
    setState((current) => ({ ...current, intensity }));
  }, []);

  const togglePlaying = useCallback(() => {
    setState((current) => ({ ...current, playing: !current.playing }));
  }, []);

  const stop = useCallback(() => {
    setState((current) => ({ ...current, beat: 0, playing: false }));
  }, []);

  const undo = useCallback(() => {
    setState((current) => ({
      ...current,
      voices: current.voices.map((voice) =>
        voice.id === current.selectedVoice ? { ...voice, status: "empty", pattern: [] } : voice,
      ),
    }));
  }, []);

  return { state, pressPad, setMoment, setNote, setIntensity, togglePlaying, stop, undo };
}

interface VariantProps {
  readonly state: PrototypeState;
  readonly pressPad: (index: number) => void;
  readonly setMoment: (moment: number) => void;
}

function AppHeader({ state }: { readonly state: PrototypeState }) {
  return (
    <header className="app-header">
      <div>
        <span className="eyebrow">C25 Loop sketcher · prototype</span>
        <h1>{state.title}</h1>
      </div>
      <div className="transport-readout" aria-label="Transport state">
        <span className={`connection-dot ${state.playing ? "is-live" : ""}`} />
        <strong>{state.playing ? "Playing" : "Paused"}</strong>
        <span>{state.tempo} BPM</span>
        <span>{Math.floor(state.beat / 4) + 1}.{(state.beat % 4) + 1}</span>
        <span className="device-pill">C25 connected</span>
      </div>
    </header>
  );
}

function StateRibbon({ state, variant }: { readonly state: PrototypeState; readonly variant: VariantKey }) {
  const active = state.voices.filter((voice) => voice.status !== "empty").length;
  const recording = state.voices.find((voice) => voice.status === "recording");
  return (
    <div className="state-ribbon" aria-label="Full prototype state">
      <span><i>Surface</i>{variantNames[variant]}</span>
      <span><i>Voices</i>{active} of 8</span>
      <span><i>Selected</i>Pad {state.selectedVoice + 1} · {state.voices[state.selectedVoice]?.role}</span>
      <span><i>Capture</i>{recording ? recording.role : "Ready"}</span>
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
              <strong>{voice.status === "empty" ? "+ Capture" : voice.name}</strong>
              <Pattern pattern={voice.pattern} />
              <span className="cell-meta">{voice.status} · {voice.bars} bars</span>
            </button>
          ))}
        </div>
        <aside className="cell-coach">
          <span className="coach-step">NOW</span>
          <strong>Bring in the chords</strong>
          <p>Tap pad 4 to unmute, or play a new phrase on the keys to replace it.</p>
          <div className="beat-ring"><span>{(state.beat % 4) + 1}</span><small>beat</small></div>
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
  readonly setNote: (note: string | null) => void;
  readonly setIntensity: (intensity: number) => void;
  readonly togglePlaying: () => void;
  readonly stop: () => void;
  readonly undo: () => void;
}

function C25Dock({ state, pressPad, setNote, setIntensity, togglePlaying, stop, undo }: C25DockProps) {
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
        {keys.map((key) => <button className={state.note === key ? "is-down" : ""} key={key} onPointerDown={() => setNote(key)} onPointerLeave={() => setNote(null)} onPointerUp={() => setNote(null)} type="button"><span>{key}</span></button>)}
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
      <AppHeader state={sketch.state} />
      <StateRibbon state={sketch.state} variant={variant} />
      {content}
      <C25Dock
        pressPad={sketch.pressPad}
        setIntensity={sketch.setIntensity}
        setNote={sketch.setNote}
        state={sketch.state}
        stop={sketch.stop}
        togglePlaying={sketch.togglePlaying}
        undo={sketch.undo}
      />
      <PrototypeSwitcher current={variant} onChange={changeVariant} />
    </div>
  );
}
