import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SynthEngine, SynthParams, SynthType } from '@/audio/SynthEngine';
import { LooperEngine } from '@/audio/LooperEngine';
import { AudioInputEngine } from '@/audio/AudioInputEngine';
import { DEFAULT_PARAMS, PRESETS, Preset } from '@/audio/presets';
import Knob from '@/components/synth/Knob';
import WheelControl from '@/components/synth/WheelControl';
import OscillatorSection from '@/components/synth/OscillatorSection';
import FilterSection from '@/components/synth/FilterSection';
import EnvelopeSection from '@/components/synth/EnvelopeSection';
import LFOSection from '@/components/synth/LFOSection';
import PresetSelector from '@/components/synth/PresetSelector';
import Keyboard from '@/components/synth/Keyboard';
import SequencerSection, { SequencerSectionHandle } from '@/components/synth/SequencerSection';
import LooperSection from '@/components/synth/LooperSection';
import InputMixer from '@/components/synth/InputMixer';
import { Circle, Pause, Play, Square, Download, Eye } from 'lucide-react';

const SYNTH_TYPES: { value: SynthType; label: string }[] = [
  { value: 'analog', label: 'ANALOG' },
  { value: 'wavetable', label: 'WAVETABLE' },
  { value: 'fm', label: 'FM' },
];

const Index: React.FC = () => {
  const [params, setParams] = useState<SynthParams>({ ...DEFAULT_PARAMS });
  const [octave, setOctave] = useState(1);
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [currentPreset, setCurrentPreset] = useState<string | null>('Init Patch');
  const [initialized, setInitialized] = useState(false);
  const engineRef = useRef<SynthEngine | null>(null);
  const looperRef = useRef<LooperEngine | null>(null);
  const inputRef = useRef<AudioInputEngine | null>(null);
  const sequencerRef = useRef<SequencerSectionHandle | null>(null);

  // Master recording state machine: 'idle' | 'recording' | 'paused' | 'previewing'
  type RecState = 'idle' | 'recording' | 'paused' | 'stopped' | 'previewing';
  const [recState, setRecState] = useState<RecState>('idle');
  const [masterRecordElapsed, setMasterRecordElapsed] = useState(0);
  const recTimerRef = useRef<number | null>(null);
  const seqPausePositionRef = useRef<{ step: number; contextTime: number; bpm: number } | null>(null);

  // Sequencer state (for looper sync)
  const [sequencerPlaying, setSequencerPlaying] = useState(false);
  const [sequencerBpm, setSequencerBpm] = useState(120);

  useEffect(() => {
    engineRef.current = new SynthEngine(params);
    looperRef.current = new LooperEngine();
    inputRef.current = new AudioInputEngine();
    return () => {
      engineRef.current?.panic();
      looperRef.current?.destroy();
      inputRef.current?.destroy();
    };
  }, []);

  const ensureInit = useCallback(async () => {
    if (!engineRef.current) return;
    if (!initialized) {
      await engineRef.current.init();
      setInitialized(true);

      // Init looper with the synth's shared audio context and master gain
      if (looperRef.current && engineRef.current) {
        const ctx = engineRef.current.getAudioContext();
        const masterGain = engineRef.current.getMasterGain();
        if (ctx) {
          looperRef.current.init(ctx, ctx.destination, masterGain);

          // Init input engine with same audio context and master gain
          if (inputRef.current && masterGain) {
            inputRef.current.init(ctx, masterGain, looperRef.current.getMasterStreamDest());
          }
        }
      }
    }
  }, [initialized]);

  const updateParams = useCallback((newParams: Partial<SynthParams>) => {
    setParams(prev => {
      const updated = { ...prev, ...newParams };
      engineRef.current?.updateParams(newParams);
      return updated;
    });
    setCurrentPreset(null);
  }, []);

  const handleNoteOn = useCallback(async (note: number) => {
    await ensureInit();
    engineRef.current?.noteOn(note);
    setActiveNotes(prev => new Set(prev).add(note));
  }, [ensureInit]);

  const handleNoteOff = useCallback((note: number) => {
    engineRef.current?.noteOff(note);
    setActiveNotes(prev => {
      const next = new Set(prev);
      next.delete(note);
      return next;
    });
  }, []);

  const handleReleaseAll = useCallback(() => {
    engineRef.current?.releaseAll();
    setActiveNotes(new Set());
  }, []);

  const handlePanic = useCallback(() => {
    engineRef.current?.panic();
    setActiveNotes(new Set());
  }, []);

  const handlePreset = useCallback((preset: Preset) => {
    const newParams = { ...DEFAULT_PARAMS, ...preset.params };
    setParams(newParams);
    engineRef.current?.updateParams(newParams);
    setCurrentPreset(preset.name);
  }, []);

  const handleAdsrChange = useCallback((adsr: SynthParams['adsr']) => {
    updateParams({ adsr });
  }, [updateParams]);

  const handleModAdsrChange = useCallback((fmModAdsr: SynthParams['fmModAdsr']) => {
    updateParams({ fmModAdsr });
  }, [updateParams]);

  // Elapsed timer helper
  const startElapsedTimer = useCallback(() => {
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    recTimerRef.current = window.setInterval(() => {
      setMasterRecordElapsed(looperRef.current?.getMasterRecordElapsed() ?? 0);
    }, 200);
  }, []);

  const stopElapsedTimer = useCallback(() => {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
  }, []);

  // REC button: idle → recording
  const handleStartRec = useCallback(async () => {
    await ensureInit();
    if (!looperRef.current) return;
    looperRef.current.startMasterRecording();
    setRecState('recording');
    setMasterRecordElapsed(0);
    startElapsedTimer();
  }, [ensureInit, startElapsedTimer]);

  // PAUSE button: recording → paused
  const handlePauseRec = useCallback(() => {
    if (!looperRef.current) return;
    looperRef.current.pauseMasterRecording();
    stopElapsedTimer();
    // Pause sequencer and store position
    const pos = sequencerRef.current?.pauseSequencer() ?? null;
    seqPausePositionRef.current = pos;
    // Disable input monitoring
    inputRef.current?.setMonitoring(false);
    setRecState('paused');
  }, [stopElapsedTimer]);

  // REC button from paused → resume recording
  const handleResumeRec = useCallback(() => {
    if (!looperRef.current) return;
    looperRef.current.resumeMasterRecording();
    startElapsedTimer();
    // Resume sequencer from exact pause position
    if (seqPausePositionRef.current) {
      sequencerRef.current?.resumeFromPosition(seqPausePositionRef.current);
    }
    setRecState('recording');
  }, [startElapsedTimer]);

  // PREVIEW button from paused/stopped → previewing
  const handlePreview = useCallback(async () => {
    if (!looperRef.current) return;
    const prevState = recState;
    setRecState('previewing');
    await looperRef.current.previewMasterRecording(() => {
      // On preview end → back to previous state, NOT resume sequencer
      setRecState(prevState === 'stopped' ? 'stopped' : 'paused');
    });
  }, [recState]);

  // STOP preview
  const handleStopPreview = useCallback(() => {
    looperRef.current?.stopMasterPreview();
    // Go back to paused or stopped depending on where we came from
    setRecState(prev => prev === 'previewing' ? 'paused' : prev);
  }, []);

  // STOP recording → stopped (keeps data, doesn't download yet)
  const handleStopRec = useCallback(() => {
    if (!looperRef.current) return;
    looperRef.current.pauseMasterRecording(); // pause, don't finalize
    stopElapsedTimer();
    // If currently previewing, stop preview first
    looperRef.current.stopMasterPreview();
    setRecState('stopped');
  }, [stopElapsedTimer]);

  // SAVE → finalize and download
  const handleSaveRec = useCallback(() => {
    if (!looperRef.current) return;
    looperRef.current.stopMasterRecording(); // triggers download
    stopElapsedTimer();
    setRecState('idle');
    setMasterRecordElapsed(0);
    seqPausePositionRef.current = null;
  }, [stopElapsedTimer]);

  // Cleanup rec timer
  useEffect(() => {
    return () => { if (recTimerRef.current) clearInterval(recTimerRef.current); };
  }, []);
  const formatTime = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className="min-h-screen flex flex-col bg-background surface-texture"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header */}
      <header className="bg-synth-panel px-3 py-2 flex items-center justify-between border-b-2 border-synth-panel-border">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-led-amber animate-led-pulse led-glow-sm" />
          <h1 className="font-display text-sm md:text-base text-led-amber tracking-widest">
            RETROSYNTH
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <PresetSelector onSelect={handlePreset} currentPreset={currentPreset} />

          {/* Master Recording Transport — all 5 buttons always visible */}
          {(() => {
            const isIdle = recState === 'idle';
            const isRec = recState === 'recording';
            const isPaused = recState === 'paused';
            const isStopped = recState === 'stopped';
            const isPreviewing = recState === 'previewing';

            const recEnabled = isIdle || isPaused;
            const pauseEnabled = isRec;
            const stopEnabled = isRec || isPaused || isPreviewing;
            const previewEnabled = isPaused || isStopped;
            const saveEnabled = isStopped || isPreviewing;

            const btnBase = "w-[52px] h-[36px] p-0 rounded font-display border transition-colors flex flex-col items-center justify-center";
            const btnDisabled = "opacity-25 cursor-not-allowed pointer-events-none border-synth-panel-border bg-synth-surface-dark text-synth-panel-foreground";
            const btnAvailable = "opacity-100 cursor-pointer border-led-amber/60 bg-synth-surface-dark text-led-amber hover:bg-led-amber/10";
            const btnActive = "opacity-100 border-led-amber bg-led-amber/20 text-led-amber";

            return (
              <div className="flex flex-row gap-1.5 flex-shrink-0">
                {/* REC */}
                <button
                  onClick={recEnabled ? (isPaused ? handleResumeRec : handleStartRec) : undefined}
                  className={`${btnBase} ${isRec ? `${btnActive} animate-pulse !text-led-red !border-led-red !bg-led-red/20` : recEnabled ? btnAvailable : btnDisabled}`}
                >
                  <Circle className="w-3 h-3" fill={isRec ? 'currentColor' : 'none'} />
                  <span className="text-[8px] tracking-wider leading-none mt-0.5">REC</span>
                </button>

                {/* PAUSE */}
                <button
                  onClick={pauseEnabled ? handlePauseRec : undefined}
                  className={`${btnBase} ${isPaused ? btnActive : pauseEnabled ? btnAvailable : btnDisabled}`}
                >
                  <Pause className="w-3 h-3" />
                  <span className="text-[8px] tracking-wider leading-none mt-0.5">PAUSE</span>
                </button>

                {/* STOP */}
                <button
                  onClick={stopEnabled ? handleStopRec : undefined}
                  className={`${btnBase} ${isStopped ? btnActive : stopEnabled ? btnAvailable : btnDisabled}`}
                >
                  <Square className="w-3 h-3" />
                  <span className="text-[8px] tracking-wider leading-none mt-0.5">STOP</span>
                </button>

                {/* PREVIEW */}
                <button
                  onClick={previewEnabled ? handlePreview : isPreviewing ? handleStopPreview : undefined}
                  className={`${btnBase} ${isPreviewing ? `${btnActive} animate-pulse !text-led-green !border-led-green !bg-led-green/20` : previewEnabled ? btnAvailable : btnDisabled}`}
                >
                  <Play className="w-3 h-3" />
                  <span className="text-[8px] tracking-wider leading-none mt-0.5">{isPreviewing ? 'STOP' : 'PREVIEW'}</span>
                </button>

                {/* SAVE */}
                <button
                  onClick={saveEnabled ? handleSaveRec : undefined}
                  className={`${btnBase} ${saveEnabled ? btnAvailable : btnDisabled}`}
                >
                  <Download className="w-3 h-3" />
                  <span className="text-[8px] tracking-wider leading-none mt-0.5">SAVE</span>
                </button>
              </div>
            );
          })()}

          {/* Elapsed time display */}
          {(recState === 'recording' || recState === 'paused' || recState === 'stopped') && (
            <span className="font-mono-synth text-[10px] text-led-amber">{formatTime(masterRecordElapsed)}</span>
          )}



          {/* PANIC button */}
          <button
            onClick={handlePanic}
            className="min-w-[44px] min-h-[44px] px-3 py-2 rounded font-display text-[10px] tracking-wider border border-led-red bg-led-red/20 text-led-red hover:bg-led-red/40 active:bg-led-red/60 transition-colors"
          >
            PANIC
          </button>
        </div>
      </header>

      {/* Input Mixer */}
      <InputMixer inputEngine={inputRef.current} initialized={initialized} ensureInit={ensureInit} />

      {/* Top controls */}
      <div className="bg-synth-panel p-3 border-b border-synth-panel-border">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1">
            {SYNTH_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => updateParams({ type: t.value })}
                className={`min-w-[44px] min-h-[44px] px-3 py-2 rounded font-display text-[10px] tracking-wider border transition-colors
                  ${params.type === t.value
                    ? 'bg-led-amber/20 text-led-amber border-led-amber led-glow-sm'
                    : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border hover:border-synth-panel-foreground/30'
                  }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <Knob value={params.masterVolume} min={0} max={1} label="Volume" onChange={(v) => updateParams({ masterVolume: v })} size="md" />
          <Knob value={params.glide} min={0} max={1} label="Glide" onChange={(v) => updateParams({ glide: v })} size="sm" />
          <WheelControl value={params.pitchBend} onChange={(v) => updateParams({ pitchBend: v })} label="Pitch" centered />
          <WheelControl value={params.modWheel} onChange={(v) => updateParams({ modWheel: v })} label="Mod" />
        </div>
      </div>

      {/* Middle controls */}
      <div className="flex-1 bg-synth-panel p-3 overflow-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-synth-surface-dark/50 rounded-lg p-3 panel-shadow">
            <OscillatorSection params={params} onChange={updateParams} />
          </div>
          <div className="bg-synth-surface-dark/50 rounded-lg p-3 panel-shadow">
            <FilterSection params={params} onChange={updateParams} />
          </div>
          <div className="bg-synth-surface-dark/50 rounded-lg p-3 panel-shadow">
            <EnvelopeSection adsr={params.adsr} onChange={handleAdsrChange} label="Amp Env" />
          </div>
          <div className="bg-synth-surface-dark/50 rounded-lg p-3 panel-shadow">
            {params.type === 'fm' ? (
              <EnvelopeSection adsr={params.fmModAdsr} onChange={handleModAdsrChange} label="Mod Env" />
            ) : (
              <LFOSection params={params} onChange={updateParams} />
            )}
          </div>
        </div>

        {params.type === 'fm' && (
          <div className="mt-4 max-w-[200px]">
            <div className="bg-synth-surface-dark/50 rounded-lg p-3 panel-shadow">
              <LFOSection params={params} onChange={updateParams} />
            </div>
          </div>
        )}
      </div>

      {/* Sequencer */}
      <SequencerSection
        ref={sequencerRef}
        synthEngine={engineRef.current}
        initialized={initialized}
        ensureInit={ensureInit}
        onPlayingChange={setSequencerPlaying}
        onBpmChange={setSequencerBpm}
        onStartTimeChange={(time) => looperRef.current?.setSequencerStartTime(time)}
        recordingDest={looperRef.current?.getMasterStreamDest() || null}
        masterGain={engineRef.current?.getMasterGain() || null}
      />

      {/* Looper */}
      <LooperSection
        looperEngine={looperRef.current}
        bpm={sequencerBpm}
        sequencerPlaying={sequencerPlaying}
      />

      {/* Keyboard - sticky bottom */}
      <div className="sticky bottom-0 bg-card border-t-2 border-border shadow-lg">
        <Keyboard
          octave={octave}
          onNoteOn={handleNoteOn}
          onNoteOff={handleNoteOff}
          onOctaveChange={setOctave}
          onReleaseAll={handleReleaseAll}
          activeNotes={activeNotes}
        />
      </div>

      {/* Init overlay */}
      {!initialized && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-synth-surface-dark/80 backdrop-blur-sm cursor-pointer"
          onClick={ensureInit}
          onTouchStart={ensureInit}
        >
          <div className="text-center space-y-3">
            <div className="w-4 h-4 mx-auto rounded-full bg-led-amber animate-led-pulse led-glow" />
            <p className="font-display text-lg text-led-amber tracking-widest">RETROSYNTH</p>
            <p className="font-mono-synth text-sm text-synth-panel-foreground">TAP TO START</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;
