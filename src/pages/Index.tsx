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
          <RecTransport
            looperRef={looperRef}
            sequencerRef={sequencerRef}
            inputRef={inputRef}
            ensureInit={ensureInit}
          />
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

      {/* Keyboard - sticky bottom, collapsible */}
      <div className="sticky bottom-0 z-20 bg-card border-t-2 border-border shadow-lg">
        <button
          onClick={() => setKeyboardVisible(v => !v)}
          className="w-full flex items-center justify-center gap-1 py-1 bg-synth-panel text-synth-panel-foreground/60 text-[9px] font-display tracking-wider hover:text-synth-panel-foreground transition-colors"
        >
          {keyboardVisible ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          {keyboardVisible ? 'HIDE KEYS' : '⌨ SHOW KEYS'}
        </button>
        <div className={keyboardVisible ? '' : 'hidden'}>
          <Keyboard
            octave={octave}
            onNoteOn={handleNoteOn}
            onNoteOff={handleNoteOff}
            onOctaveChange={setOctave}
            onReleaseAll={handleReleaseAll}
            activeNotes={activeNotes}
          />
        </div>
      </div>
    </>
  );

  // ===== MOBILE LAYOUT =====
  const renderMobile = () => (
    <>
      {/* Header */}
      <header className="bg-synth-panel px-2 py-1.5 border-b-2 border-synth-panel-border">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-led-amber animate-led-pulse led-glow-sm" />
            <h1 className="font-display text-[10px] text-led-amber tracking-widest">RETROSYNTH</h1>
          </div>
          <button
            onClick={handlePanic}
            className="min-w-[36px] min-h-[36px] rounded font-display text-[8px] tracking-wider border border-led-red bg-led-red/20 text-led-red active:bg-led-red/60 transition-colors flex items-center justify-center p-0 leading-none flex-shrink-0"
          >
            PANIC
          </button>
        </div>
        <div className="flex justify-end overflow-x-auto">
          <RecTransport
            looperRef={looperRef}
            sequencerRef={sequencerRef}
            inputRef={inputRef}
            ensureInit={ensureInit}
          />
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

      {/* Tab Content — all tabs always mounted, hidden via CSS to preserve state */}
      <div className="flex-1 overflow-auto bg-synth-panel relative">
        <div className={activeTab === 'synth' ? '' : 'hidden'}>{renderMobileSynth()}</div>
        <div className={activeTab === 'drum' ? '' : 'hidden'}>{renderMobileDrum()}</div>
        <div className={activeTab === 'loop' ? '' : 'hidden'}>{renderMobileLoop()}</div>
        <div className={activeTab === 'fx' ? '' : 'hidden'}>{renderMobileFx()}</div>
      </div>

      {/* Keyboard — collapsible, sticky bottom, always mounted */}
      <div className="sticky bottom-0 z-20 bg-card border-t-2 border-border shadow-lg">
        <button
          onClick={() => setKeyboardVisible(v => !v)}
          className="w-full min-h-[36px] flex items-center justify-center gap-1 py-1 bg-synth-panel text-synth-panel-foreground/60 text-[9px] font-display tracking-wider active:text-synth-panel-foreground transition-colors"
        >
          {keyboardVisible ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          {keyboardVisible ? 'HIDE KEYS' : '⌨ SHOW KEYS'}
        </button>
        <div className={keyboardVisible ? '' : 'hidden'}>
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
      </div>
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
