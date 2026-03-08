import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SynthEngine, SynthParams, SynthType } from '@/audio/SynthEngine';
import { DEFAULT_PARAMS, PRESETS, Preset } from '@/audio/presets';
import Knob from '@/components/synth/Knob';
import WheelControl from '@/components/synth/WheelControl';
import OscillatorSection from '@/components/synth/OscillatorSection';
import FilterSection from '@/components/synth/FilterSection';
import EnvelopeSection from '@/components/synth/EnvelopeSection';
import LFOSection from '@/components/synth/LFOSection';
import PresetSelector from '@/components/synth/PresetSelector';
import Keyboard from '@/components/synth/Keyboard';

const SYNTH_TYPES: { value: SynthType; label: string }[] = [
  { value: 'analog', label: 'ANALOG' },
  { value: 'wavetable', label: 'WAVETABLE' },
  { value: 'fm', label: 'FM' },
];

const Index: React.FC = () => {
  const [params, setParams] = useState<SynthParams>({ ...DEFAULT_PARAMS });
  const [octave, setOctave] = useState(1); // C3 = octave 1
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [currentPreset, setCurrentPreset] = useState<string | null>('Init Patch');
  const [initialized, setInitialized] = useState(false);
  const engineRef = useRef<SynthEngine | null>(null);

  // Initialize engine
  useEffect(() => {
    engineRef.current = new SynthEngine(params);
    return () => {
      engineRef.current?.panic();
    };
  }, []);

  const ensureInit = useCallback(async () => {
    if (!engineRef.current) return;
    if (!initialized) {
      await engineRef.current.init();
      setInitialized(true);
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
        <PresetSelector onSelect={handlePreset} currentPreset={currentPreset} />
      </header>

      {/* Top controls */}
      <div className="bg-synth-panel p-3 border-b border-synth-panel-border">
        <div className="flex flex-wrap items-end gap-3">
          {/* Synth type selector */}
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

          <Knob
            value={params.masterVolume}
            min={0} max={1}
            label="Volume"
            onChange={(v) => updateParams({ masterVolume: v })}
            size="md"
          />
          <Knob
            value={params.glide}
            min={0} max={1}
            label="Glide"
            onChange={(v) => updateParams({ glide: v })}
            size="sm"
          />
          <WheelControl
            value={params.pitchBend}
            onChange={(v) => updateParams({ pitchBend: v })}
            label="Pitch"
            centered
          />
          <WheelControl
            value={params.modWheel}
            onChange={(v) => updateParams({ modWheel: v })}
            label="Mod"
          />
        </div>
      </div>

      {/* Middle controls */}
      <div className="flex-1 bg-synth-panel p-3 overflow-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Oscillator */}
          <div className="bg-synth-surface-dark/50 rounded-lg p-3 panel-shadow">
            <OscillatorSection params={params} onChange={updateParams} />
          </div>

          {/* Filter */}
          <div className="bg-synth-surface-dark/50 rounded-lg p-3 panel-shadow">
            <FilterSection params={params} onChange={updateParams} />
          </div>

          {/* ADSR */}
          <div className="bg-synth-surface-dark/50 rounded-lg p-3 panel-shadow">
            <EnvelopeSection adsr={params.adsr} onChange={handleAdsrChange} label="Amp Env" />
          </div>

          {/* LFO or FM Mod ADSR */}
          <div className="bg-synth-surface-dark/50 rounded-lg p-3 panel-shadow">
            {params.type === 'fm' ? (
              <EnvelopeSection adsr={params.fmModAdsr} onChange={handleModAdsrChange} label="Mod Env" />
            ) : (
              <LFOSection params={params} onChange={updateParams} />
            )}
          </div>
        </div>

        {/* LFO also visible in FM mode */}
        {params.type === 'fm' && (
          <div className="mt-4 max-w-[200px]">
            <div className="bg-synth-surface-dark/50 rounded-lg p-3 panel-shadow">
              <LFOSection params={params} onChange={updateParams} />
            </div>
          </div>
        )}
      </div>

      {/* Keyboard - sticky bottom */}
      <div className="sticky bottom-0 bg-card border-t-2 border-border shadow-lg">
        <Keyboard
          octave={octave}
          onNoteOn={handleNoteOn}
          onNoteOff={handleNoteOff}
          onOctaveChange={setOctave}
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
            <p className="font-mono-synth text-sm text-synth-panel-foreground">
              TAP TO START
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;
