import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { FxEngine, FX_SOUNDS } from '@/audio/FxEngine';
import { SynthEngine } from '@/audio/SynthEngine';
import Knob from './Knob';

interface FxPadProps {
  synthEngine: SynthEngine | null;
  initialized: boolean;
  ensureInit: () => Promise<void>;
  recordingDest?: AudioNode | null;
  masterGain?: GainNode | null;
  defaultExpanded?: boolean;
  mobileGrid?: boolean;
}

const FxPad: React.FC<FxPadProps> = ({ synthEngine, initialized, ensureInit, recordingDest, masterGain, defaultExpanded, mobileGrid }) => {
  const [collapsed, setCollapsed] = useState(!defaultExpanded);
  const [volume, setVolume] = useState(0.7);
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const fxRef = useRef<FxEngine | null>(null);
  const initedRef = useRef(false);

  useEffect(() => {
    if (!fxRef.current) fxRef.current = new FxEngine();
  }, []);

  useEffect(() => {
    if (initialized && synthEngine && !initedRef.current && fxRef.current) {
      const ctx = synthEngine.getAudioContext();
      if (ctx) {
        fxRef.current.init(ctx, masterGain || ctx.destination, recordingDest);
        initedRef.current = true;
      }
    }
  }, [initialized, synthEngine, masterGain, recordingDest]);

  useEffect(() => {
    fxRef.current?.setVolume(volume);
  }, [volume]);

  const handlePress = useCallback(async (id: string) => {
    await ensureInit();
    if (!initedRef.current && fxRef.current && synthEngine) {
      const ctx = synthEngine.getAudioContext();
      if (ctx) {
        fxRef.current.init(ctx, masterGain || ctx.destination, recordingDest);
        initedRef.current = true;
      }
    }
    fxRef.current?.trigger(id);
    setActiveIds(prev => new Set(prev).add(id));
  }, [ensureInit, synthEngine, masterGain, recordingDest]);

  const handleRelease = useCallback((id: string) => {
    fxRef.current?.stop(id);
    setActiveIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Auto-clear active state after sound finishes
  useEffect(() => {
    if (activeIds.size === 0) return;
    const timer = setTimeout(() => setActiveIds(new Set()), 3000);
    return () => clearTimeout(timer);
  }, [activeIds]);

  return (
    <div className="bg-synth-panel border-t border-synth-panel-border">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-synth-surface-dark/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronRight className="w-4 h-4 text-synth-panel-foreground" /> : <ChevronDown className="w-4 h-4 text-synth-panel-foreground" />}
          <span className="font-display text-[11px] text-led-amber tracking-widest">FX PAD</span>
        </div>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-3">
          {/* Volume control */}
          <div className="flex items-end gap-3">
            <Knob value={volume} min={0} max={1} label="FX VOL" onChange={setVolume} size="md" />
          </div>

          {/* Button grid */}
          <div className="space-y-1.5">
            {FX_SOUNDS.map((row, rowIdx) => (
              <div key={rowIdx} className="flex gap-1.5 flex-wrap">
                {row.map(fx => {
                  const isActive = activeIds.has(fx.id);
                  return (
                    <button
                      key={fx.id}
                      onPointerDown={(e) => { e.preventDefault(); handlePress(fx.id); }}
                      onPointerUp={() => handleRelease(fx.id)}
                      onPointerLeave={() => { if (activeIds.has(fx.id)) handleRelease(fx.id); }}
                      className={`
                        w-[70px] h-[70px] rounded-md border-2 transition-all duration-75
                        flex flex-col items-center justify-center gap-1
                        select-none touch-manipulation
                        ${isActive
                          ? 'bg-led-amber/30 border-led-amber text-led-amber led-glow-sm scale-95'
                          : 'bg-synth-surface-dark border-led-amber/30 text-synth-panel-foreground hover:border-led-amber/60 hover:bg-synth-surface-dark/80'
                        }
                      `}
                    >
                      <span className="text-lg leading-none">{fx.emoji}</span>
                      <span className="text-[8px] font-display tracking-wider leading-none">{fx.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default FxPad;