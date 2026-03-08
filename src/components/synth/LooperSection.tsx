import React, { useState, useCallback, useEffect } from 'react';
import { ChevronDown, ChevronRight, Circle, Play, Pause, X } from 'lucide-react';
import { LooperEngine, LoopSlot, SlotState } from '@/audio/LooperEngine';
import Knob from './Knob';
import WaveformEditor from './WaveformEditor';

interface LooperSectionProps {
  looperEngine: LooperEngine | null;
  bpm: number;
  sequencerPlaying: boolean;
}

const BAR_OPTIONS: (1 | 2 | 4 | 8)[] = [1, 2, 4, 8];

const stateLabel = (state: SlotState, isOverdub: boolean, isPending: boolean): string => {
  if (isPending) return 'WAIT...';
  switch (state) {
    case 'empty': return 'EMPTY';
    case 'recording': return isOverdub ? 'ODUB' : 'REC';
    case 'recorded': return 'READY';
    case 'playing': return 'PLAY';
  }
};

const stateColor = (state: SlotState): string => {
  switch (state) {
    case 'recording': return 'text-led-red';
    case 'playing': return 'text-led-green';
    default: return 'text-synth-panel-foreground/50';
  }
};

const LooperSection: React.FC<LooperSectionProps> = ({ looperEngine, bpm, sequencerPlaying }) => {
  const [collapsed, setCollapsed] = useState(true);
  const [slots, setSlots] = useState<LoopSlot[]>(() =>
    Array.from({ length: 4 }, () => ({
      state: 'empty' as SlotState,
      isOverdub: false,
      buffer: null,
      bars: 2 as 1 | 2 | 4 | 8,
      volume: 0.8,
      waveformData: [],
      startOffset: 0,
      endOffset: 0,
      fadeIn: 0.02,
      fadeOut: 0.02,
    }))
  );
  const [bufferDurations, setBufferDurations] = useState([0, 0, 0, 0]);
  const [syncToBpm, setSyncToBpm] = useState(true);
  const [metronome, setMetronome] = useState(false);
  const [countIn, setCountIn] = useState(0);
  const [pendingSlots, setPendingSlots] = useState<boolean[]>([false, false, false, false]);

  // Global double-tap zoom prevention
  useEffect(() => {
    let lastTap = 0;
    const handler = (e: TouchEvent) => {
      const now = Date.now();
      if (now - lastTap < 300) {
        e.preventDefault();
      }
      lastTap = now;
    };
    document.addEventListener('touchend', handler, { passive: false });
    return () => document.removeEventListener('touchend', handler);
  }, []);

  // Sync settings to engine
  useEffect(() => {
    if (looperEngine) {
      looperEngine.setBpm(bpm);
      looperEngine.setSyncToBpm(syncToBpm);
      looperEngine.setMetronomeEnabled(metronome);
      looperEngine.setSequencerPlaying(sequencerPlaying);
    }
  }, [looperEngine, bpm, syncToBpm, metronome, sequencerPlaying]);

  // Set callbacks
  useEffect(() => {
    if (!looperEngine) return;
    looperEngine.setOnSlotChange((index, slot) => {
      setSlots(prev => {
        const next = [...prev];
        next[index] = slot;
        return next;
      });
      setPendingSlots(prev => {
        const next = [...prev];
        next[index] = looperEngine.isSlotPending(index);
        return next;
      });
      setBufferDurations(prev => {
        const next = [...prev];
        next[index] = looperEngine.getSlotBufferDuration(index);
        return next;
      });
    });
    looperEngine.setOnCountIn((beat) => {
      setCountIn(beat);
      if (beat >= 4) setTimeout(() => setCountIn(0), 500);
    });
  }, [looperEngine]);

  // Stop loops when sequencer stops
  useEffect(() => {
    if (!looperEngine) return;
    if (!sequencerPlaying) {
      looperEngine.stopAllSlots();
    }
  }, [looperEngine, sequencerPlaying]);

  const handleSlotRecord = useCallback((index: number) => {
    if (!looperEngine) return;
    looperEngine.handleRecButton(index);
  }, [looperEngine]);

  const handleSlotPlayToggle = useCallback((index: number) => {
    looperEngine?.toggleSlotPlayback(index);
  }, [looperEngine]);

  const handleSlotClear = useCallback((index: number) => {
    looperEngine?.clearSlot(index);
  }, [looperEngine]);

  const handleSlotBars = useCallback((index: number, bars: 1 | 2 | 4 | 8) => {
    looperEngine?.setSlotBars(index, bars);
    setSlots(prev => {
      const next = [...prev];
      next[index] = { ...next[index], bars };
      return next;
    });
  }, [looperEngine]);

  const handleSlotVolume = useCallback((index: number, volume: number) => {
    looperEngine?.setSlotVolume(index, volume);
    setSlots(prev => {
      const next = [...prev];
      next[index] = { ...next[index], volume };
      return next;
    });
  }, [looperEngine]);

  const handleStopAll = useCallback(() => {
    looperEngine?.stopAllSlots();
  }, [looperEngine]);

  return (
    <div className="bg-synth-panel border-t border-synth-panel-border">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-synth-surface-dark/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronRight className="w-4 h-4 text-synth-panel-foreground" /> : <ChevronDown className="w-4 h-4 text-synth-panel-foreground" />}
          <span className="font-display text-[11px] text-led-amber tracking-widest">LOOPER</span>
          {slots.some(s => s.state === 'playing') && <div className="w-2 h-2 rounded-full bg-led-green animate-led-pulse" />}
          {slots.some(s => s.state === 'recording') && <div className="w-2 h-2 rounded-full bg-led-red animate-led-pulse" />}
        </div>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-3">
          {/* Looper Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1">
              {(['FREE', 'SYNC'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setSyncToBpm(mode === 'SYNC')}
                  className={`min-w-[44px] min-h-[36px] px-2 py-1 rounded font-display text-[8px] tracking-wider border transition-colors
                    ${(mode === 'SYNC') === syncToBpm
                      ? 'bg-led-amber/20 text-led-amber border-led-amber'
                      : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border hover:border-synth-panel-foreground/30'
                    }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            <button
              onClick={() => setMetronome(!metronome)}
              className={`min-w-[44px] min-h-[36px] px-3 py-1 rounded font-display text-[8px] tracking-wider border transition-colors
                ${metronome
                  ? 'bg-led-amber/20 text-led-amber border-led-amber'
                  : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border hover:border-synth-panel-foreground/30'
                }`}
            >
              METRO
            </button>

            <button
              onClick={handleStopAll}
              className="min-w-[44px] min-h-[36px] px-3 py-1 rounded font-display text-[8px] tracking-wider border border-led-red bg-led-red/10 text-led-red hover:bg-led-red/30 transition-colors"
            >
              STOP ALL
            </button>

            {countIn > 0 && (
              <span className="font-display text-lg text-led-amber animate-led-pulse">{countIn}</span>
            )}
          </div>

          {/* 4 Loop Slots */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {slots.map((slot, i) => {
              const isRecording = slot.state === 'recording';
              const isPlaying = slot.state === 'playing';
              const isPending = pendingSlots[i];
              const duration = bufferDurations[i];
              const startRatio = duration > 0 ? slot.startOffset / duration : 0;
              const endRatio = duration > 0 ? (slot.endOffset > 0 ? slot.endOffset / duration : 1) : 1;
              const fadeInRatio = duration > 0 ? slot.fadeIn / duration : 0;
              const fadeOutRatio = duration > 0 ? slot.fadeOut / duration : 0;
              
              return (
                <div
                  key={i}
                  className={`bg-synth-surface-dark/60 rounded-lg p-2.5 panel-shadow border transition-colors
                    ${isRecording
                      ? 'border-led-red animate-pulse'
                      : isPlaying
                        ? 'border-led-amber led-glow-sm'
                        : 'border-synth-panel-border'
                    }`}
                >
                  {/* Slot header */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-display text-xs text-led-amber">{i + 1}</span>
                    <span className={`font-mono-synth text-[8px] tracking-wider ${isPending ? 'text-led-amber animate-led-pulse' : stateColor(slot.state)}`}>
                      {stateLabel(slot.state, slot.isOverdub, isPending)}
                    </span>
                  </div>

                  {/* Waveform with start/end/fade editors */}
                  <div className="bg-synth-surface-dark rounded p-1 mb-2">
                    <WaveformEditor
                      waveformData={slot.waveformData}
                      startOffsetRatio={startRatio}
                      endOffsetRatio={endRatio}
                      fadeInRatio={fadeInRatio}
                      fadeOutRatio={fadeOutRatio}
                      bufferDuration={duration}
                      syncToBpm={syncToBpm}
                      bpm={bpm}
                      isPlaying={isPlaying}
                      onStartOffsetChange={(sec) => {
                        looperEngine?.setSlotStartOffset(i, sec);
                        setSlots(prev => { const n = [...prev]; n[i] = { ...n[i], startOffset: sec }; return n; });
                      }}
                      onEndOffsetChange={(sec) => {
                        looperEngine?.setSlotEndOffset(i, sec);
                        setSlots(prev => { const n = [...prev]; n[i] = { ...n[i], endOffset: sec }; return n; });
                      }}
                      onFadeInChange={(sec) => {
                        looperEngine?.setSlotFadeIn(i, sec);
                        setSlots(prev => { const n = [...prev]; n[i] = { ...n[i], fadeIn: sec }; return n; });
                      }}
                      onFadeOutChange={(sec) => {
                        looperEngine?.setSlotFadeOut(i, sec);
                        setSlots(prev => { const n = [...prev]; n[i] = { ...n[i], fadeOut: sec }; return n; });
                      }}
                    />
                  </div>

                  {/* Bar selector */}
                  <div className="flex gap-0.5 mb-2">
                    {BAR_OPTIONS.map(b => (
                      <button
                        key={b}
                        onClick={() => handleSlotBars(i, b)}
                        disabled={slot.state !== 'empty' && slot.state !== 'recorded'}
                        className={`flex-1 min-h-[28px] px-1 py-0.5 rounded font-display text-[7px] tracking-wider border transition-colors
                          ${slot.bars === b
                            ? 'bg-led-amber/20 text-led-amber border-led-amber'
                            : 'bg-synth-surface-dark text-synth-panel-foreground/50 border-synth-panel-border hover:border-synth-panel-foreground/30'
                          }`}
                      >
                        {b}B
                      </button>
                    ))}
                  </div>

                  {/* Controls row */}
                  <div className="flex items-center gap-1.5">
                    {/* REC */}
                    <button
                      onClick={() => handleSlotRecord(i)}
                      className={`min-w-[36px] min-h-[36px] flex items-center justify-center rounded border transition-colors
                        ${isRecording
                          ? 'bg-led-red/30 text-led-red border-led-red animate-pulse'
                          : slot.state === 'empty'
                            ? 'bg-synth-surface-dark text-synth-panel-foreground/40 border-synth-panel-border hover:border-led-red/50 hover:text-led-red'
                            : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border hover:border-led-red/50 hover:text-led-red'
                        }`}
                    >
                      <Circle className="w-3.5 h-3.5" fill={isRecording ? 'currentColor' : 'none'} />
                    </button>

                    {/* Play/Stop */}
                    <button
                      onClick={() => handleSlotPlayToggle(i)}
                      disabled={!slot.buffer && slot.state !== 'playing'}
                      className={`min-w-[36px] min-h-[36px] flex items-center justify-center rounded border transition-colors
                        ${isPlaying
                          ? 'bg-led-green/20 text-led-green border-led-green'
                          : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border hover:border-synth-panel-foreground/40'
                        } disabled:opacity-30`}
                    >
                      {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>

                    {/* Clear */}
                    <button
                      onClick={() => handleSlotClear(i)}
                      disabled={slot.state === 'empty'}
                      className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded border border-synth-panel-border bg-synth-surface-dark text-synth-panel-foreground hover:border-led-red/50 hover:text-led-red transition-colors disabled:opacity-30"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>

                    {/* Volume */}
                    <div className="ml-auto">
                      <Knob
                        value={slot.volume}
                        min={0}
                        max={1}
                        label="VOL"
                        onChange={(v) => handleSlotVolume(i, v)}
                        size="sm"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default LooperSection;
