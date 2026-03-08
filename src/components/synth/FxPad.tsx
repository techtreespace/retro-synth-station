import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { FxEngine, FX_CATEGORIES } from '@/audio/FxEngine';
import { SynthEngine } from '@/audio/SynthEngine';
import Knob from './Knob';
import { useIsMobile } from '@/hooks/use-mobile';

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
  const isMobile = useIsMobile();

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

  useEffect(() => {
    if (activeIds.size === 0) return;
    const timer = setTimeout(() => setActiveIds(new Set()), 3000);
    return () => clearTimeout(timer);
  }, [activeIds]);

  const useMobileLayout = mobileGrid || isMobile;

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
          {/* Header row: title area + volume control top-right */}
          <div className="flex items-end justify-end">
            {useMobileLayout ? (
              <div className="flex items-center gap-2 w-full">
                <span className="text-[9px] font-mono tracking-wider text-synth-panel-foreground uppercase">FX VOL</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={e => setVolume(parseFloat(e.target.value))}
                  className="flex-1 h-2 accent-led-amber bg-synth-surface-dark rounded-full appearance-none cursor-pointer
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-led-amber
                    [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-led-amber [&::-moz-range-thumb]:border-0"
                />
                <span className="text-[9px] font-mono text-synth-panel-foreground w-8 text-right">{Math.round(volume * 100)}%</span>
              </div>
            ) : (
              <Knob value={volume} min={0} max={1} label="FX VOL" onChange={setVolume} size="md" />
            )}
          </div>

          {/* Category groups */}
          <div className="space-y-0">
            {FX_CATEGORIES.map((cat, catIdx) => (
              <div key={cat.name} className="flex flex-col w-full">
                {/* Divider between categories */}
                {catIdx > 0 && <div className="w-full h-px bg-led-amber/20 my-2" />}

                {/* Category label */}
                <span className="text-[10px] tracking-[2px] text-led-amber/70 pl-0.5 mb-1.5 font-display select-none">
                  {cat.icon} {cat.name}
                </span>

                {/* Button row */}
                <div className={`flex gap-1.5 w-full ${useMobileLayout ? 'flex-wrap' : ''}`}>
                  {cat.sounds.map(fx => {
                    const isActive = activeIds.has(fx.id);
                    return (
                      <button
                        key={fx.id}
                        onPointerDown={(e) => { e.preventDefault(); handlePress(fx.id); }}
                        onPointerUp={() => handleRelease(fx.id)}
                        onPointerLeave={() => { if (activeIds.has(fx.id)) handleRelease(fx.id); }}
                        className={`
                          flex flex-col items-center justify-center gap-1.5
                          rounded-md border transition-all duration-75
                          select-none touch-manipulation
                          ${useMobileLayout
                            ? 'h-[72px] basis-[calc(50%-3px)] flex-shrink-0'
                            : 'h-[80px] flex-1 min-w-0'
                          }
                          ${isActive
                            ? 'bg-led-amber/[0.13] border-led-amber-glow text-led-amber'
                            : 'bg-synth-surface-dark border-led-amber/40 text-synth-panel-foreground hover:border-led-amber hover:bg-synth-surface-dark/80'
                          }
                        `}
                      >
                        <span className={`leading-none ${useMobileLayout ? 'text-2xl' : 'text-[22px]'}`}>{fx.emoji}</span>
                        <span className="text-[9px] font-display tracking-[1px] leading-none text-center">{fx.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default FxPad;
