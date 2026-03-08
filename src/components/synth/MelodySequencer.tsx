import React, { useCallback, useRef, useState, useEffect } from 'react';
import { MelodyPattern } from '@/audio/SequencerEngine';

interface MelodySequencerProps {
  pattern: MelodyPattern;
  currentStep: number;
  playing: boolean;
  patternLength: number;
  onToggleStep: (step: number) => void;
  onNoteChange: (step: number, note: number) => void;
  onVelocityChange: (step: number, velocity: number) => void;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[midi % 12];
  return `${name}${octave}`;
}

// C2 (36) to C6 (84)
const NOTE_OPTIONS: number[] = [];
for (let i = 36; i <= 84; i++) NOTE_OPTIONS.push(i);

function velocityColor(v: number): string {
  if (v > 90) return 'bg-led-amber';
  if (v >= 50) return 'bg-led-amber/70';
  return 'bg-led-amber/40';
}

const MelodySequencer: React.FC<MelodySequencerProps> = ({
  pattern, currentStep, playing, patternLength,
  onToggleStep, onNoteChange, onVelocityChange,
}) => {
  const [tooltip, setTooltip] = useState<{ step: number; value: number } | null>(null);
  const [editStep, setEditStep] = useState<number | null>(null);
  const tooltipTimer = useRef<number | null>(null);
  const dragStartY = useRef<number>(0);
  const dragStartVel = useRef<number>(0);
  const dragged = useRef(false);
  const [flashStep, setFlashStep] = useState<number | null>(null);

  // Flash effect on playback
  useEffect(() => {
    if (!playing) return;
    const step = pattern.steps[currentStep];
    if (step?.active) {
      setFlashStep(currentStep);
      const t = window.setTimeout(() => setFlashStep(null), 80);
      return () => clearTimeout(t);
    }
  }, [currentStep, playing, pattern.steps]);

  const showTooltip = useCallback((step: number, value: number) => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setTooltip({ step, value });
    tooltipTimer.current = window.setTimeout(() => setTooltip(null), 1000);
  }, []);

  const handlePointerDown = useCallback((step: number, e: React.PointerEvent) => {
    e.preventDefault();
    dragStartY.current = e.clientY;
    dragStartVel.current = pattern.steps[step].velocity;
    dragged.current = false;

    showTooltip(step, pattern.steps[step].velocity);

    const onMove = (me: PointerEvent) => {
      const dy = dragStartY.current - me.clientY;
      if (Math.abs(dy) > 2) dragged.current = true;
      const newVel = Math.max(0, Math.min(127, Math.round(dragStartVel.current + dy)));
      onVelocityChange(step, newVel);
      showTooltip(step, newVel);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!dragged.current) {
        // Click without drag → reset to 100
        onVelocityChange(step, 100);
        showTooltip(step, 100);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [pattern.steps, onVelocityChange, showTooltip]);

  const handleDoubleClick = useCallback((step: number) => {
    setEditStep(step);
  }, []);

  const handleEditSubmit = useCallback((step: number, val: string) => {
    const n = parseInt(val);
    if (!isNaN(n)) {
      onVelocityChange(step, Math.max(0, Math.min(127, n)));
    }
    setEditStep(null);
  }, [onVelocityChange]);

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-[2px]" style={{ minWidth: patternLength * 52 }}>
        {Array.from({ length: patternLength }, (_, stepIdx) => {
          const step = pattern.steps[stepIdx];
          if (!step) return null;
          const isCurrent = playing && currentStep === stepIdx;
          const isFlashing = flashStep === stepIdx;

          return (
            <div
              key={stepIdx}
              className={`
                flex flex-col items-center gap-1 p-1 rounded-sm border min-w-[50px]
                ${step.active
                  ? 'bg-led-amber/10 border-led-amber/50'
                  : 'bg-synth-surface-dark/40 border-synth-panel-border/30'
                }
                ${isCurrent ? 'ring-2 ring-accent ring-offset-0' : ''}
              `}
            >
              {/* Toggle + note name */}
              <button
                onPointerDown={(e) => { e.preventDefault(); onToggleStep(stepIdx); }}
                className={`w-full h-5 rounded-sm text-[8px] font-mono-synth transition-colors
                  ${step.active
                    ? 'bg-led-amber/30 text-led-amber'
                    : 'bg-synth-surface-dark/60 text-synth-panel-foreground/40'
                  }`}
              >
                {step.active ? midiToName(step.note) : '—'}
              </button>

              {/* Note selector */}
              {step.active && (
                <select
                  value={step.note}
                  onChange={(e) => onNoteChange(stepIdx, parseInt(e.target.value))}
                  className="w-full text-[8px] font-mono-synth bg-synth-surface-dark border border-synth-panel-border text-synth-panel-foreground rounded-sm px-0.5 py-0.5"
                >
                  {NOTE_OPTIONS.map(n => (
                    <option key={n} value={n}>{midiToName(n)}</option>
                  ))}
                </select>
              )}

              {/* Velocity bar */}
              <div className="w-full relative">
                {/* Tooltip */}
                {tooltip?.step === stepIdx && (
                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 z-10 bg-synth-surface-dark border border-led-amber/40 text-led-amber text-[8px] font-mono-synth px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none">
                    {tooltip.value}
                  </div>
                )}
                {editStep === stepIdx ? (
                  <input
                    autoFocus
                    type="number"
                    min={0}
                    max={127}
                    defaultValue={step.velocity}
                    className="w-full h-14 text-[9px] font-mono-synth bg-synth-surface-dark border border-led-amber text-led-amber text-center rounded-sm"
                    onBlur={(e) => handleEditSubmit(stepIdx, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleEditSubmit(stepIdx, (e.target as HTMLInputElement).value);
                      if (e.key === 'Escape') setEditStep(null);
                    }}
                  />
                ) : (
                  <div
                    className={`w-full h-14 rounded-sm relative cursor-ns-resize touch-manipulation transition-colors ${
                      isFlashing ? 'bg-white/30' : 'bg-synth-surface-dark/60'
                    }`}
                    onPointerDown={(e) => handlePointerDown(stepIdx, e)}
                    onDoubleClick={() => handleDoubleClick(stepIdx)}
                    onPointerEnter={() => showTooltip(stepIdx, step.velocity)}
                  >
                    <div
                      className={`absolute bottom-0 left-0 right-0 rounded-sm transition-all ${
                        isFlashing ? 'bg-white/80' : velocityColor(step.velocity)
                      }`}
                      style={{ height: `${Math.max((step.velocity / 127) * 100, 2.5)}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MelodySequencer;
