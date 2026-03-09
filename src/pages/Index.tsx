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
import FxPad from '@/components/synth/FxPad';
import RecTransport from '@/components/synth/RecTransport';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

const SYNTH_TYPES: { value: SynthType; label: string }[] = [
  { value: 'analog', label: 'ANALOG' },
  { value: 'wavetable', label: 'WAVETABLE' },
  { value: 'fm', label: 'FM' },
];

type MobileTab = 'synth' | 'drum' | 'loop' | 'fx';
type ExportFormat = 'wav' | 'webm' | 'mp4';

const MOBILE_TABS: { id: MobileTab; label: string }[] = [
  { id: 'synth', label: 'SYNTH' },
  { id: 'drum', label: 'DRUM' },
  { id: 'loop', label: 'LOOP' },
  { id: 'fx', label: 'FX' },
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
  const isMobile = useIsMobile();

  // Mobile tab state
  const [activeTab, setActiveTab] = useState<MobileTab>('synth');
  const [keyboardVisible, setKeyboardVisible] = useState(true);

  // Export format
  const [exportFormat, setExportFormat] = useState<ExportFormat>(() => {
    return (localStorage.getItem('retrosynth-export-format') as ExportFormat) || 'wav';
  });
  const [showFormatPicker, setShowFormatPicker] = useState(false);
  const formatPickerRef = useRef<HTMLDivElement>(null);

  // Master recording state machine: 'idle' | 'recording' | 'paused' | 'stopped' | 'previewing'
  type RecState = 'idle' | 'recording' | 'paused' | 'stopped' | 'previewing';
  const [recState, setRecState] = useState<RecState>('idle');
  const [masterRecordElapsed, setMasterRecordElapsed] = useState(0);
  const [showNewRecConfirm, setShowNewRecConfirm] = useState(false);
  const recTimerRef = useRef<number | null>(null);
  const seqPausePositionRef = useRef<{ step: number; contextTime: number; bpm: number } | null>(null);

  // Sequencer state (for looper sync)
  const [sequencerPlaying, setSequencerPlaying] = useState(false);
  const [sequencerBpm, setSequencerBpm] = useState(120);

  // Persist export format
  useEffect(() => {
    localStorage.setItem('retrosynth-export-format', exportFormat);
  }, [exportFormat]);

  // Close format picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (formatPickerRef.current && !formatPickerRef.current.contains(e.target as Node)) {
        setShowFormatPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

      if (looperRef.current && engineRef.current) {
        const ctx = engineRef.current.getAudioContext();
        const masterGain = engineRef.current.getMasterGain();
        if (ctx) {
          looperRef.current.init(ctx, ctx.destination, masterGain);
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

  const handleStartRec = useCallback(async () => {
    await ensureInit();
    if (!looperRef.current) return;
    looperRef.current.startMasterRecording();
    setRecState('recording');
    setMasterRecordElapsed(0);
    startElapsedTimer();
  }, [ensureInit, startElapsedTimer]);

  // Called when REC is clicked in STOPPED state — shows confirmation first
  const handleNewRecFromStopped = useCallback(() => {
    setShowNewRecConfirm(true);
  }, []);

  // Confirmed: discard current and start fresh
  const handleConfirmNewRec = useCallback(async () => {
    setShowNewRecConfirm(false);
    await ensureInit();
    if (!looperRef.current) return;
    looperRef.current.discardMasterRecording();
    looperRef.current.startMasterRecording();
    setRecState('recording');
    setMasterRecordElapsed(0);
    startElapsedTimer();
  }, [ensureInit, startElapsedTimer]);

  const handlePauseRec = useCallback(() => {
    if (!looperRef.current) return;
    looperRef.current.pauseMasterRecording();
    stopElapsedTimer();
    const pos = sequencerRef.current?.pauseSequencer() ?? null;
    seqPausePositionRef.current = pos;
    inputRef.current?.setMonitoring(false);
    setRecState('paused');
  }, [stopElapsedTimer]);

  const handleResumeRec = useCallback(() => {
    if (!looperRef.current) return;
    looperRef.current.resumeMasterRecording();
    startElapsedTimer();
    if (seqPausePositionRef.current) {
      sequencerRef.current?.resumeFromPosition(seqPausePositionRef.current);
    }
    setRecState('recording');
  }, [startElapsedTimer]);

  const handlePreview = useCallback(async () => {
    if (!looperRef.current) return;
    const prevState = recState;
    setRecState('previewing');
    await looperRef.current.previewMasterRecording(() => {
      setRecState(prevState === 'stopped' ? 'stopped' : 'paused');
    });
  }, [recState]);

  const handleStopPreview = useCallback(() => {
    looperRef.current?.stopMasterPreview();
    setRecState('stopped');
  }, []);

  const handleStopRec = useCallback(() => {
    if (!looperRef.current) return;
    looperRef.current.pauseMasterRecording();
    stopElapsedTimer();
    looperRef.current.stopMasterPreview();
    setRecState('stopped');
  }, [stopElapsedTimer]);

  const handleSaveRec = useCallback(() => {
    if (!looperRef.current) return;
    looperRef.current.stopMasterRecording(exportFormat);
    stopElapsedTimer();
    setRecState('idle');
    setMasterRecordElapsed(0);
    seqPausePositionRef.current = null;
  }, [stopElapsedTimer, exportFormat]);

  useEffect(() => {
    return () => { if (recTimerRef.current) clearInterval(recTimerRef.current); };
  }, []);

  const formatTime = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // ===== TRANSPORT BAR (shared) =====
  const renderTransport = () => {
    const isIdle = recState === 'idle';
    const isRec = recState === 'recording';
    const isPaused = recState === 'paused';
    const isStopped = recState === 'stopped';
    const isPreviewing = recState === 'previewing';

    // Updated: recEnabled includes STOPPED state
    const recEnabled = isIdle || isPaused || isStopped;
    const pauseEnabled = isRec;
    const stopEnabled = isRec || isPaused || isPreviewing;
    const previewEnabled = isPaused || isStopped;
    const saveEnabled = isStopped || isPreviewing;

    const btnBase = "w-[44px] h-[32px] md:w-[52px] md:h-[36px] p-0 rounded font-display border transition-colors flex flex-col items-center justify-center";
    const btnDisabled = "opacity-25 cursor-not-allowed pointer-events-none border-synth-panel-border bg-synth-surface-dark text-synth-panel-foreground";
    const btnAvailable = "opacity-100 cursor-pointer border-led-amber/60 bg-synth-surface-dark text-led-amber hover:bg-led-amber/10";
    const btnActive = "opacity-100 border-led-amber bg-led-amber/20 text-led-amber";

    const recClick = isPaused ? handleResumeRec : isStopped ? handleNewRecFromStopped : handleStartRec;

    return (
      <div className="flex flex-row gap-1 flex-shrink-0 items-center">
        {/* Confirmation modal for new recording in STOPPED state */}
        {showNewRecConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowNewRecConfirm(false)}>
            <div className="bg-synth-panel border border-synth-panel-border rounded-lg p-5 max-w-[320px] w-full shadow-xl" onClick={e => e.stopPropagation()}>
              <p className="font-display text-[11px] tracking-wider text-led-amber mb-4">현재 녹음된 내용이 삭제됩니다.<br />새로 녹음하시겠습니까?</p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowNewRecConfirm(false)}
                  className="px-4 py-2 rounded font-display text-[10px] tracking-wider border border-synth-panel-border bg-synth-surface-dark text-synth-panel-foreground hover:border-synth-panel-foreground/40 transition-colors"
                >취소</button>
                <button
                  onClick={handleConfirmNewRec}
                  className="px-4 py-2 rounded font-display text-[10px] tracking-wider border border-led-red bg-led-red/20 text-led-red hover:bg-led-red/40 transition-colors"
                >새로 녹음</button>
              </div>
            </div>
          </div>
        )}

        {/* REC */}
        <button
          onClick={recEnabled ? recClick : undefined}
          className={`${btnBase} ${
            isRec
              ? `${btnActive} animate-pulse !text-led-red !border-led-red !bg-led-red/20`
              : isStopped
                ? 'opacity-100 cursor-pointer border-dashed border-led-red/70 bg-synth-surface-dark text-led-red hover:bg-led-red/10'
                : recEnabled ? btnAvailable : btnDisabled
          }`}
        >
          <Circle className="w-3 h-3" fill={isRec ? 'currentColor' : 'none'} />
          <span className="text-[7px] tracking-wider leading-none mt-0.5">{isStopped ? 'NEW' : 'REC'}</span>
        </button>

        {/* PAUSE */}
        <button
          onClick={pauseEnabled ? handlePauseRec : undefined}
          className={`${btnBase} ${isPaused ? btnActive : pauseEnabled ? btnAvailable : btnDisabled}`}
        >
          <Pause className="w-3 h-3" />
          <span className="text-[7px] tracking-wider leading-none mt-0.5">PAUSE</span>
        </button>

        {/* STOP */}
        <button
          onClick={stopEnabled ? handleStopRec : undefined}
          className={`${btnBase} ${isStopped ? btnActive : stopEnabled ? btnAvailable : btnDisabled}`}
        >
          <Square className="w-3 h-3" />
          <span className="text-[7px] tracking-wider leading-none mt-0.5">STOP</span>
        </button>

        {/* PREVIEW */}
        <button
          onClick={previewEnabled ? handlePreview : isPreviewing ? handleStopPreview : undefined}
          className={`${btnBase} ${isPreviewing ? `${btnActive} animate-pulse !text-led-green !border-led-green !bg-led-green/20` : previewEnabled ? btnAvailable : btnDisabled}`}
        >
          <Play className="w-3 h-3" />
          <span className="text-[7px] tracking-wider leading-none mt-0.5">{isPreviewing ? 'STOP' : 'PRE'}</span>
        </button>

        {/* SAVE + format */}
        <div className="relative flex items-center gap-0.5" ref={formatPickerRef}>
          <button
            onClick={saveEnabled ? handleSaveRec : undefined}
            className={`${btnBase} ${saveEnabled ? btnAvailable : btnDisabled}`}
          >
            <Download className="w-3 h-3" />
            <span className="text-[7px] tracking-wider leading-none mt-0.5">SAVE</span>
          </button>
          <button
            onClick={() => setShowFormatPicker(!showFormatPicker)}
            className="w-[28px] h-[32px] md:h-[36px] flex flex-col items-center justify-center rounded border border-synth-panel-border bg-synth-surface-dark text-synth-panel-foreground hover:border-synth-panel-foreground/40 transition-colors"
          >
            <Settings className="w-3 h-3" />
            <span className="text-[6px] font-mono-synth leading-none mt-0.5 text-led-amber">{exportFormat.toUpperCase()}</span>
          </button>

          {showFormatPicker && (
            <div className="absolute top-full right-0 mt-1 z-50 bg-synth-surface-dark border border-synth-panel-border rounded shadow-lg min-w-[140px]">
              {([
                { value: 'wav' as ExportFormat, label: 'WAV', desc: 'recommended' },
                { value: 'webm' as ExportFormat, label: 'WEBM', desc: 'smaller file' },
                { value: 'mp4' as ExportFormat, label: 'MP4', desc: 'iOS Safari' },
              ]).map(f => (
                <button
                  key={f.value}
                  onClick={() => { setExportFormat(f.value); setShowFormatPicker(false); }}
                  className={`w-full text-left px-3 py-2 min-h-[36px] flex items-center gap-2 transition-colors ${
                    exportFormat === f.value
                      ? 'text-led-amber bg-led-amber/10'
                      : 'text-synth-panel-foreground hover:bg-synth-panel-border/30'
                  }`}
                >
                  <span className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${
                    exportFormat === f.value ? 'border-led-amber bg-led-amber' : 'border-synth-panel-foreground/40'
                  }`} />
                  <div>
                    <span className="text-[10px] font-display tracking-wider">{f.label}</span>
                    <span className="text-[8px] font-mono-synth ml-1 opacity-50">{f.desc}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Elapsed time */}
        {(recState === 'recording' || recState === 'paused' || recState === 'stopped') && (
          <span className={`font-mono-synth text-[10px] ml-1 ${recState === 'recording' ? 'text-led-red' : recState === 'paused' ? 'text-led-amber' : 'text-synth-panel-foreground/60'}`}>
            {formatTime(masterRecordElapsed)}{recState === 'stopped' ? ' 완료' : ''}
          </span>
        )}
      </div>
    );
  };

  // ===== DESKTOP LAYOUT =====
  const renderDesktop = () => (
    <>
      {/* Header */}
      <header className="bg-synth-panel px-3 py-2 flex items-center justify-between border-b-2 border-synth-panel-border">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-led-amber animate-led-pulse led-glow-sm" />
          <h1 className="font-display text-sm md:text-base text-led-amber tracking-widest">RETROSYNTH</h1>
        </div>
        <div className="flex items-center gap-2">
          <PresetSelector onSelect={handlePreset} currentPreset={currentPreset} />
          {renderTransport()}
          <button
            onClick={handlePanic}
            className="min-w-[44px] min-h-[44px] rounded font-display text-[10px] tracking-wider border border-led-red bg-led-red/20 text-led-red hover:bg-led-red/40 active:bg-led-red/60 transition-colors flex items-center justify-center p-0 leading-none"
          >
            <span className="block w-full text-center leading-none">PANIC</span>
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

      {/* FX Pad */}
      <FxPad
        synthEngine={engineRef.current}
        initialized={initialized}
        ensureInit={ensureInit}
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
    </>
  );

  // ===== MOBILE LAYOUT =====
  const renderMobile = () => (
    <>
      {/* Header */}
      <header className="bg-synth-panel px-2 py-1.5 flex items-center justify-between border-b-2 border-synth-panel-border">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-led-amber animate-led-pulse led-glow-sm" />
          <h1 className="font-display text-[10px] text-led-amber tracking-widest">RETROSYNTH</h1>
        </div>
        <div className="flex items-center gap-1">
          {renderTransport()}
          <button
            onClick={handlePanic}
            className="min-w-[36px] min-h-[36px] rounded font-display text-[8px] tracking-wider border border-led-red bg-led-red/20 text-led-red hover:bg-led-red/40 active:bg-led-red/60 transition-colors flex items-center justify-center p-0 leading-none"
          >
            <span className="block w-full text-center leading-none">PANIC</span>
          </button>
        </div>
      </header>

      {/* Mobile Tab Bar — sticky */}
      <div className="sticky top-0 z-30 bg-synth-panel border-b border-synth-panel-border flex">
        {MOBILE_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 min-h-[44px] font-display text-[10px] tracking-widest transition-colors relative ${
              activeTab === tab.id
                ? 'text-led-amber'
                : 'text-synth-panel-foreground/60 hover:text-synth-panel-foreground'
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-led-amber" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto bg-synth-panel">
        {activeTab === 'synth' && renderMobileSynth()}
        {activeTab === 'drum' && renderMobileDrum()}
        {activeTab === 'loop' && renderMobileLoop()}
        {activeTab === 'fx' && renderMobileFx()}
      </div>

      {/* Keyboard — collapsible, sticky bottom */}
      {keyboardVisible ? (
        <div className="sticky bottom-0 z-20 bg-card border-t-2 border-border shadow-lg">
          <button
            onClick={() => setKeyboardVisible(false)}
            className="w-full flex items-center justify-center gap-1 py-1 bg-synth-panel text-synth-panel-foreground/60 text-[9px] font-display tracking-wider"
          >
            <ChevronDown className="w-3 h-3" /> KEYS
          </button>
          <Keyboard
            octave={octave}
            onNoteOn={handleNoteOn}
            onNoteOff={handleNoteOff}
            onOctaveChange={setOctave}
            onReleaseAll={handleReleaseAll}
            activeNotes={activeNotes}
            mobileMode
          />
        </div>
      ) : (
        <button
          onClick={() => setKeyboardVisible(true)}
          className="sticky bottom-0 z-20 w-full min-h-[36px] bg-synth-surface-dark border-t border-synth-panel-border flex items-center justify-center gap-1 text-synth-panel-foreground/50 text-[10px] font-display tracking-wider"
        >
          <ChevronUp className="w-3 h-3" /> ⌨ TAP TO SHOW KEYS
        </button>
      )}
    </>
  );

  // ===== MOBILE SYNTH TAB =====
  const renderMobileSynth = () => (
    <div className="p-3 space-y-3">
      {/* Synth type + presets */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1">
          {SYNTH_TYPES.map(t => (
            <button
              key={t.value}
              onClick={() => updateParams({ type: t.value })}
              className={`min-w-[44px] min-h-[44px] px-3 py-2 rounded font-display text-[10px] tracking-wider border transition-colors
                ${params.type === t.value
                  ? 'bg-led-amber/20 text-led-amber border-led-amber led-glow-sm'
                  : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border'
                }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <PresetSelector onSelect={handlePreset} currentPreset={currentPreset} />
      </div>

      {/* Oscillator */}
      <div className="bg-synth-surface-dark/50 rounded-lg p-3 panel-shadow">
        <OscillatorSection params={params} onChange={updateParams} />
      </div>

      {/* Filter — large knobs */}
      <div className="bg-synth-surface-dark/50 rounded-lg p-3 panel-shadow">
        <FilterSection params={params} onChange={updateParams} />
      </div>

      {/* ADSR */}
      <div className="bg-synth-surface-dark/50 rounded-lg p-3 panel-shadow">
        <EnvelopeSection adsr={params.adsr} onChange={handleAdsrChange} label="Amp Env" />
      </div>

      {/* LFO */}
      <div className="bg-synth-surface-dark/50 rounded-lg p-3 panel-shadow">
        {params.type === 'fm' ? (
          <>
            <EnvelopeSection adsr={params.fmModAdsr} onChange={handleModAdsrChange} label="Mod Env" />
            <div className="mt-3">
              <LFOSection params={params} onChange={updateParams} />
            </div>
          </>
        ) : (
          <LFOSection params={params} onChange={updateParams} />
        )}
      </div>

      {/* Volume + controls */}
      <div className="flex flex-wrap items-end gap-3">
        <Knob value={params.masterVolume} min={0} max={1} label="Volume" onChange={(v) => updateParams({ masterVolume: v })} size="md" />
        <Knob value={params.glide} min={0} max={1} label="Glide" onChange={(v) => updateParams({ glide: v })} size="sm" />
      </div>

      {/* Input Mixer */}
      <InputMixer inputEngine={inputRef.current} initialized={initialized} ensureInit={ensureInit} />
    </div>
  );

  // ===== MOBILE DRUM TAB =====
  const renderMobileDrum = () => (
    <div className="p-2">
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
        defaultExpanded
      />
    </div>
  );

  // ===== MOBILE LOOP TAB =====
  const renderMobileLoop = () => (
    <div className="p-2">
      <LooperSection
        looperEngine={looperRef.current}
        bpm={sequencerBpm}
        sequencerPlaying={sequencerPlaying}
        defaultExpanded
      />
    </div>
  );

  // ===== MOBILE FX TAB =====
  const renderMobileFx = () => (
    <div className="p-2">
      <FxPad
        synthEngine={engineRef.current}
        initialized={initialized}
        ensureInit={ensureInit}
        recordingDest={looperRef.current?.getMasterStreamDest() || null}
        masterGain={engineRef.current?.getMasterGain() || null}
        defaultExpanded
        mobileGrid
      />
    </div>
  );

  return (
    <div
      className="min-h-screen flex flex-col bg-background surface-texture"
      onContextMenu={(e) => e.preventDefault()}
    >
      {isMobile ? renderMobile() : renderDesktop()}

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
