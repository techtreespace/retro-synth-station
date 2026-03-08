import React, { useState, useCallback, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { ChevronDown, ChevronRight, Play, Square, Pause } from 'lucide-react';
import { SequencerEngine, createInitialDrumPattern, createInitialMelodyPattern, DrumPattern, MelodyPattern } from '@/audio/SequencerEngine';
import { DrumSound, DRUM_SOUNDS, DrumSoundParams, getDefaultDrumParams } from '@/audio/DrumEngine';
import { SynthEngine } from '@/audio/SynthEngine';
import DrumGrid from './DrumGrid';
import MelodySequencer from './MelodySequencer';
import Knob from './Knob';

export interface SequencerSectionHandle {
  pauseSequencer: () => { step: number; contextTime: number; bpm: number } | null;
  resumeFromPosition: (position: { step: number }) => void;
  isPlaying: () => boolean;
}

interface SequencerSectionProps {
  synthEngine: SynthEngine | null;
  initialized: boolean;
  ensureInit: () => Promise<void>;
  onPlayingChange?: (playing: boolean) => void;
  onBpmChange?: (bpm: number) => void;
  onStartTimeChange?: (time: number) => void;
  recordingDest?: AudioNode | null;
  masterGain?: GainNode | null;
}

const PATTERN_LENGTHS: (8 | 16 | 32)[] = [8, 16, 32];

const SequencerSection = forwardRef<SequencerSectionHandle, SequencerSectionProps>(({ synthEngine, initialized, ensureInit, onPlayingChange, onBpmChange, onStartTimeChange, recordingDest, masterGain }, ref) => {
  const [collapsed, setCollapsed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [bpm, setBpm] = useState(120);
  const [swing, setSwing] = useState(0);
  const [patternLength, setPatternLength] = useState<8 | 16 | 32>(16);
  const [drumPattern, setDrumPattern] = useState<DrumPattern>(() => createInitialDrumPattern(16));
  const [melodyPattern, setMelodyPattern] = useState<MelodyPattern>(() => createInitialMelodyPattern(16));
  const [melodySync, setMelodySync] = useState(true);
  const [transpose, setTranspose] = useState(0);
  const [gateLength, setGateLength] = useState(0.5);
  const [trackVolumes, setTrackVolumes] = useState<Record<DrumSound, number>>(() => {
    const vols: Record<string, number> = {};
    DRUM_SOUNDS.forEach(s => vols[s.id] = 0.8);
    return vols as Record<DrumSound, number>;
  });
  const [trackParams, setTrackParams] = useState<Record<DrumSound, DrumSoundParams>>(() => getDefaultDrumParams());
  const [tapTimes, setTapTimes] = useState<number[]>([]);

  const seqRef = useRef<SequencerEngine | null>(null);
  const initedRef = useRef(false);

  // Init sequencer engine once
  useEffect(() => {
    if (!seqRef.current) {
      seqRef.current = new SequencerEngine();
    }
  }, []);

  // Ensure audio context is connected — use synth's shared AudioContext
  const ensureSeqInit = useCallback(async () => {
    await ensureInit();
    if (!initedRef.current && seqRef.current && synthEngine) {
      const ctx = synthEngine.getAudioContext();
      if (ctx) {
        seqRef.current.init(ctx, masterGain || undefined, recordingDest);
        initedRef.current = true;
      }
    }
  }, [ensureInit, synthEngine]);

  // Sync params to engine
  useEffect(() => {
    const seq = seqRef.current;
    if (!seq) return;
    seq.setBpm(bpm);
    seq.setSwing(swing);
    seq.setPatternLength(patternLength);
    seq.setDrumPattern(drumPattern);
    seq.setMelodyPattern(melodyPattern);
    seq.setMelodySync(melodySync);
    seq.setTranspose(transpose);
    seq.setGateLength(gateLength);
  }, [bpm, swing, patternLength, drumPattern, melodyPattern, melodySync, transpose, gateLength]);

  // Set callbacks
  useEffect(() => {
    const seq = seqRef.current;
    if (!seq) return;
    seq.setOnStepChange((step) => setCurrentStep(step));
    seq.setOnNoteOn((note, velocity, duration) => {
      synthEngine?.noteOn(note, velocity);
    });
    seq.setOnNoteOff((note) => {
      synthEngine?.noteOff(note);
    });
  }, [synthEngine]);

  // Expose imperative handle for parent control
  useImperativeHandle(ref, () => ({
    pauseSequencer: () => {
      const seq = seqRef.current;
      if (!seq || !playing) return null;
      const ctx = synthEngine?.getAudioContext?.();
      const position = {
        step: seq.getCurrentStep(),
        contextTime: ctx?.currentTime ?? 0,
        bpm,
      };
      seq.pause();
      setPlaying(false);
      setPaused(true);
      return position;
    },
    resumeFromPosition: (position: { step: number }) => {
      const seq = seqRef.current;
      if (!seq) return;
      seq.start(position.step);
      setPlaying(true);
      setPaused(false);
      const ctx = synthEngine?.getAudioContext?.();
      if (ctx) onStartTimeChange?.(ctx.currentTime);
    },
    isPlaying: () => playing,
  }), [playing, bpm, synthEngine, onStartTimeChange]);

  // Notify parent of playing/bpm changes
  useEffect(() => { onPlayingChange?.(playing); }, [playing, onPlayingChange]);
  useEffect(() => { onBpmChange?.(bpm); }, [bpm, onBpmChange]);

  const handlePlay = useCallback(async () => {
    const seq = seqRef.current;
    if (!seq) return;
    if (playing) {
      // Already playing → stop and reset
      seq.stop();
      setPlaying(false);
      setPaused(false);
      setCurrentStep(0);
    } else {
      await ensureSeqInit();
      if (paused) {
        seq.start(currentStep);
      } else {
        seq.start(0);
      }
      setPlaying(true);
      setPaused(false);
      // Report the AudioContext time when sequencer started for loop sync
      const ctx = synthEngine?.getAudioContext?.();
      if (ctx) {
        onStartTimeChange?.(ctx.currentTime);
      }
    }
  }, [playing, paused, currentStep, ensureSeqInit, synthEngine, onStartTimeChange]);

  const handlePause = useCallback(() => {
    const seq = seqRef.current;
    if (!seq || !playing) return;
    seq.pause();
    setPlaying(false);
    setPaused(true);
  }, [playing]);

  const handleClearAll = useCallback(() => {
    if (!window.confirm('Clear all patterns?')) return;
    const seq = seqRef.current;
    if (seq && playing) { seq.stop(); setPlaying(false); }
    setPaused(false);
    setDrumPattern(createInitialDrumPattern(patternLength));
    setMelodyPattern(createInitialMelodyPattern(patternLength));
    setCurrentStep(0);
  }, [playing, patternLength]);

  const handleToggleDrumStep = useCallback((track: number, step: number) => {
    setDrumPattern(prev => {
      const newSteps = prev.steps.map(row => [...row]);
      newSteps[track][step] = !newSteps[track][step];
      return { ...prev, steps: newSteps };
    });
  }, []);

  const handleToggleMute = useCallback((track: number) => {
    setDrumPattern(prev => {
      const newMuted = [...prev.muted];
      newMuted[track] = !newMuted[track];
      return { ...prev, muted: newMuted };
    });
  }, []);

  const handleTrackVolume = useCallback((sound: DrumSound, volume: number) => {
    setTrackVolumes(prev => ({ ...prev, [sound]: volume }));
    seqRef.current?.getDrumEngine().setTrackVolume(sound, volume);
  }, []);

  const handleTrackParamChange = useCallback((sound: DrumSound, params: DrumSoundParams) => {
    setTrackParams(prev => ({ ...prev, [sound]: params }));
    seqRef.current?.getDrumEngine().setSoundParams(sound, params);
  }, []);

  const handleToggleMelodyStep = useCallback((step: number) => {
    setMelodyPattern(prev => {
      const newSteps = [...prev.steps];
      newSteps[step] = { ...newSteps[step], active: !newSteps[step].active };
      return { steps: newSteps };
    });
  }, []);

  const handleMelodyNoteChange = useCallback((step: number, note: number) => {
    setMelodyPattern(prev => {
      const newSteps = [...prev.steps];
      newSteps[step] = { ...newSteps[step], note };
      return { steps: newSteps };
    });
  }, []);

  const handleMelodyVelocity = useCallback((step: number, velocity: number) => {
    setMelodyPattern(prev => {
      const newSteps = [...prev.steps];
      newSteps[step] = { ...newSteps[step], velocity };
      return { steps: newSteps };
    });
  }, []);

  const handlePatternLength = useCallback((len: 8 | 16 | 32) => {
    setPatternLength(len);
    setDrumPattern(prev => {
      const newSteps = DRUM_SOUNDS.map((_, i) => {
        const existing = prev.steps[i] || [];
        const row = new Array(len).fill(false);
        for (let j = 0; j < Math.min(existing.length, len); j++) row[j] = existing[j];
        return row;
      });
      return { ...prev, steps: newSteps };
    });
    setMelodyPattern(prev => {
      const newSteps = Array.from({ length: len }, (_, i) =>
        prev.steps[i] || { active: false, note: 60, velocity: 100 }
      );
      return { steps: newSteps };
    });
  }, []);

  const handleTapTempo = useCallback(() => {
    const now = Date.now();
    setTapTimes(prev => {
      const recent = [...prev, now].filter(t => now - t < 3000);
      if (recent.length >= 2) {
        const intervals = [];
        for (let i = 1; i < recent.length; i++) intervals.push(recent[i] - recent[i - 1]);
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const newBpm = Math.round(60000 / avg);
        if (newBpm >= 60 && newBpm <= 200) setBpm(newBpm);
      }
      return recent;
    });
  }, []);

  return (
    <div className="bg-synth-panel border-t border-b border-synth-panel-border">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-synth-surface-dark/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronRight className="w-4 h-4 text-synth-panel-foreground" /> : <ChevronDown className="w-4 h-4 text-synth-panel-foreground" />}
          <span className="font-display text-[11px] text-led-amber tracking-widest">SEQUENCER</span>
          {playing && <div className="w-2 h-2 rounded-full bg-led-green animate-led-pulse" />}
        </div>
        <span className="font-display text-lg text-led-amber tracking-wider">{bpm}</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-4">
          {/* Transport + Global Controls */}
          <div className="flex flex-wrap items-end gap-3">
            {/* Play */}
            <button
              onClick={handlePlay}
              className={`min-w-[44px] min-h-[44px] px-4 py-2 rounded font-display text-[10px] tracking-wider border transition-colors
                ${playing
                  ? 'bg-led-green/20 text-led-green border-led-green'
                  : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border hover:border-synth-panel-foreground/40'
                }`}
            >
              {playing ? <Square className="w-4 h-4 inline" /> : <Play className="w-4 h-4 inline" />}
            </button>

            {/* Pause */}
            <button
              onClick={handlePause}
              className={`min-w-[44px] min-h-[44px] px-3 py-2 rounded font-display text-[10px] tracking-wider border transition-colors
                ${paused
                  ? 'bg-led-amber/20 text-led-amber border-led-amber'
                  : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border hover:border-synth-panel-foreground/40'
                }`}
              disabled={!playing}
            >
              <Pause className="w-4 h-4 inline" />
            </button>

            {/* BPM */}
            <Knob value={bpm} min={60} max={200} step={1} label="BPM" onChange={setBpm} size="md" formatValue={(v) => v.toFixed(0)} />

            {/* Tap Tempo */}
            <button
              onClick={handleTapTempo}
              className="min-w-[44px] min-h-[44px] px-3 py-2 rounded font-display text-[9px] tracking-wider border border-synth-panel-border bg-synth-surface-dark text-synth-panel-foreground hover:border-synth-panel-foreground/40 active:bg-led-amber/20 transition-colors"
            >
              TAP
            </button>

            {/* Swing */}
            <Knob value={swing} min={0} max={50} step={1} label="Swing" onChange={setSwing} size="sm" formatValue={(v) => `${v.toFixed(0)}%`} />

            {/* Pattern Length */}
            <div className="flex gap-1">
              {PATTERN_LENGTHS.map(len => (
                <button
                  key={len}
                  onClick={() => handlePatternLength(len)}
                  className={`min-w-[36px] min-h-[36px] px-2 py-1 rounded font-display text-[9px] tracking-wider border transition-colors
                    ${patternLength === len
                      ? 'bg-led-amber/20 text-led-amber border-led-amber'
                      : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border hover:border-synth-panel-foreground/30'
                    }`}
                >
                  {len}
                </button>
              ))}
            </div>

            {/* Clear All */}
            <button
              onClick={handleClearAll}
              className="min-w-[44px] min-h-[44px] px-3 py-2 rounded font-display text-[9px] tracking-wider border border-led-red bg-led-red/10 text-led-red hover:bg-led-red/30 transition-colors"
            >
              CLEAR
            </button>
          </div>

          {/* Drum Machine */}
          <div className="bg-synth-surface-dark/50 rounded-lg p-3 panel-shadow">
            <h3 className="font-display text-[10px] text-led-amber tracking-widest mb-2">DRUM MACHINE</h3>
            <DrumGrid
              pattern={drumPattern}
              currentStep={currentStep}
              playing={playing}
              patternLength={patternLength}
              trackVolumes={trackVolumes}
              trackParams={trackParams}
              onToggleStep={handleToggleDrumStep}
              onToggleMute={handleToggleMute}
              onTrackVolumeChange={handleTrackVolume}
              onTrackParamChange={handleTrackParamChange}
            />
          </div>

          {/* Melody Sequencer */}
          <div className="bg-synth-surface-dark/50 rounded-lg p-3 panel-shadow">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-display text-[10px] text-led-amber tracking-widest">MELODY</h3>
              <div className="flex items-center gap-3">
                {/* Sync toggle */}
                <div className="flex gap-1">
                  {(['FREE', 'SYNC'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setMelodySync(mode === 'SYNC')}
                      className={`min-w-[36px] min-h-[28px] px-2 py-1 rounded font-display text-[8px] tracking-wider border transition-colors
                        ${(mode === 'SYNC') === melodySync
                          ? 'bg-led-amber/20 text-led-amber border-led-amber'
                          : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border hover:border-synth-panel-foreground/30'
                        }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                <Knob value={transpose} min={-12} max={12} step={1} label="Trans" onChange={setTranspose} size="sm" formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}`} />
                <Knob value={gateLength} min={0.1} max={1} step={0.05} label="Gate" onChange={setGateLength} size="sm" formatValue={(v) => `${Math.round(v * 100)}%`} />
              </div>
            </div>
            <MelodySequencer
              pattern={melodyPattern}
              currentStep={currentStep}
              playing={playing}
              patternLength={patternLength}
              onToggleStep={handleToggleMelodyStep}
              onNoteChange={handleMelodyNoteChange}
              onVelocityChange={handleMelodyVelocity}
            />
          </div>
        </div>
      )}
    </div>
  );
});

SequencerSection.displayName = 'SequencerSection';

export default SequencerSection;
