import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { VisualizationMode, VisualizationPalette } from "./domain";

export interface AudioAnalysis {
  analyserRef: MutableRefObject<AnalyserNode | null>;
  error: string | null;
  resume(): Promise<void>;
}

interface AnalysisGraph {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  analyser: AnalyserNode;
  consumers: number;
  closeTimer: number | null;
}

const analysisGraphs = new WeakMap<HTMLAudioElement, AnalysisGraph>();

export const useAudioAnalysis = (audio: HTMLAudioElement | null): AudioAnalysis => {
  const analyserRef = useRef<AnalyserNode | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!audio) return;
    let graph = analysisGraphs.get(audio);
    try {
      if (!graph) {
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.78;
        const source = context.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(context.destination);
        graph = { context, source, analyser, consumers: 0, closeTimer: null };
        analysisGraphs.set(audio, graph);
      }
      if (graph.closeTimer !== null) window.clearTimeout(graph.closeTimer);
      graph.closeTimer = null;
      graph.consumers += 1;
      contextRef.current = graph.context;
      analyserRef.current = graph.analyser;
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? `Local audio analysis could not start: ${caught.message}` : "Local audio analysis could not start.");
      return;
    }
    return () => {
      analyserRef.current = null;
      contextRef.current = null;
      if (!graph) return;
      graph.consumers = Math.max(0, graph.consumers - 1);
      if (graph.consumers > 0) return;
      graph.closeTimer = window.setTimeout(() => {
        if (!graph || graph.consumers > 0) return;
        graph.source.disconnect();
        graph.analyser.disconnect();
        void graph.context.close();
        analysisGraphs.delete(audio);
      }, 0);
    };
  }, [audio]);

  return {
    analyserRef,
    error,
    async resume() {
      if (contextRef.current?.state === "suspended") await contextRef.current.resume();
    },
  };
};

interface VisualizerProps {
  analyserRef: MutableRefObject<AnalyserNode | null>;
  mode: VisualizationMode;
  palette: VisualizationPalette;
  sensitivity: number;
  fps: 30 | 60;
  lowPower: boolean;
  reducedMotion: boolean;
  playing: boolean;
}

const palettes: Record<VisualizationPalette, { background: string; primary: string; secondary: string; accent: string; idle: string }> = {
  neon: { background: "#030705", primary: "#b7ff3c", secondary: "#ff4fa3", accent: "#78e8ff", idle: "#243126" },
  ocean: { background: "#03080d", primary: "#78e8ff", secondary: "#6f7cff", accent: "#c9f8ff", idle: "#223541" },
  monochrome: { background: "#060708", primary: "#d8dedb", secondary: "#85908b", accent: "#f5f7f6", idle: "#303632" },
};

export function Visualizer({ analyserRef, mode, palette, sensitivity, fps, lowPower, reducedMotion, playing }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    let frame = 0;
    let previousTime = 0;
    const frequency = new Uint8Array(128);
    const waveform = new Uint8Array(256);
    const colors = palettes[palette];
    const targetFrameMs = reducedMotion ? 500 : 1_000 / (lowPower ? Math.min(fps, 30) : fps);

    const resize = (): { width: number; height: number } => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const pixelWidth = Math.round(width * ratio);
      const pixelHeight = Math.round(height * ratio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      return { width, height };
    };

    const draw = (time: number): void => {
      frame = requestAnimationFrame(draw);
      if (time - previousTime < targetFrameMs) return;
      previousTime = time;
      const { width, height } = resize();
      context.fillStyle = colors.background;
      context.fillRect(0, 0, width, height);
      const analyser = analyserRef.current;
      if (!playing || !analyser) {
        context.strokeStyle = colors.idle;
        context.beginPath();
        context.moveTo(0, height / 2);
        context.lineTo(width, height / 2);
        context.stroke();
        return;
      }
      analyser.getByteFrequencyData(frequency);
      analyser.getByteTimeDomainData(waveform);

      if (mode === "waveform") {
        context.strokeStyle = colors.accent;
        context.lineWidth = 2;
        context.beginPath();
        const step = lowPower ? 4 : 2;
        for (let index = 0; index < waveform.length; index += step) {
          const x = index / (waveform.length - 1) * width;
          const y = height / 2 + ((waveform[index] ?? 128) - 128) / 128 * height * 0.42 * sensitivity;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
        return;
      }

      if (mode === "kaleidoscope" || mode === "particles") {
        const step = lowPower ? 8 : 3;
        for (let index = 0; index < frequency.length; index += step) {
          const angle = index / frequency.length * Math.PI * 2 + (reducedMotion ? 0 : time / 3_000);
          const radius = (frequency[index] ?? 0) / 255 * Math.min(width, height) * 0.42 * sensitivity;
          context.fillStyle = index % 2 ? colors.secondary : colors.primary;
          context.beginPath();
          context.arc(width / 2 + Math.cos(angle) * radius, height / 2 + Math.sin(angle) * radius, mode === "particles" ? 2 : 5, 0, Math.PI * 2);
          context.fill();
        }
        return;
      }

      if (mode === "pixel") {
        const count = lowPower ? 12 : 22;
        for (let index = 0; index < count; index += 1) {
          const bin = frequency[Math.floor(index / count * frequency.length)] ?? 0;
          const barHeight = bin / 255 * height * 0.7 * sensitivity;
          context.fillStyle = index % 3 === 0 ? colors.secondary : colors.primary;
          context.fillRect(index * width / count, height - barHeight, width / count - 2, barHeight);
        }
        return;
      }

      if (mode === "color") {
        const energy = (frequency[4] ?? 0) / 255;
        const gradient = context.createRadialGradient(width / 2, height / 2, 5, width / 2, height / 2, Math.max(width, height));
        gradient.addColorStop(0, colors.secondary);
        gradient.addColorStop(Math.min(0.85, 0.25 + energy * 0.4), colors.primary);
        gradient.addColorStop(1, colors.background);
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);
        return;
      }

      const count = lowPower ? 24 : mode === "stereo" ? 32 : 48;
      for (let index = 0; index < count; index += 1) {
        const sourceIndex = Math.floor(index / count * frequency.length);
        const barHeight = (frequency[sourceIndex] ?? 0) / 255 * height * 0.82 * sensitivity;
        context.fillStyle = index / count > 0.72 ? colors.secondary : colors.primary;
        if (mode === "stereo" && index % 2 === 1) {
          context.fillRect(index * width / count, 0, Math.max(2, width / count - 2), barHeight);
        } else {
          context.fillRect(index * width / count, height - barHeight, Math.max(2, width / count - 2), barHeight);
        }
      }
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analyserRef, fps, lowPower, mode, palette, playing, reducedMotion, sensitivity]);

  return <canvas className="visualizer" ref={canvasRef} role="img" aria-label={`${mode} local audio visualization`} />;
}
