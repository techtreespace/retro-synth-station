import React, { useCallback } from 'react';
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

const MelodySequencer: React.FC<MelodySequencerProps> = ({
  pattern, currentStep, playing, patternLength,
  onToggleStep, onNoteChange, onVelocityChange,
}) => {
  const handleVelocityDrag = useCallback((step: number, e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const startY = e.clientY;
    const startVel = pattern.steps[step].velocity;

    const onMove = (me: PointerEvent) => {
      const dy = startY - me.clientY;
      const newVel = Math.max(0, Math.min(127, Math.round(startVel + dy)));
      onVelocityChange(step, newVel);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [pattern.steps, onVelocityChange]);

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-[2px]" style={{ minWidth: patternLength * 52 }}>
        {Array.from({ length: patternLength }, (_, stepIdx) => {
          const step = pattern.steps[stepIdx];
          if (!step) return null;
          const isCurrent = playing && currentStep === stepIdx;

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
              {/* Toggle */}
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
              <div
                className="w-full h-12 bg-synth-surface-dark/60 rounded-sm relative cursor-ns-resize touch-manipulation"
                onPointerDown={(e) => handleVelocityDrag(stepIdx, e)}
              >
                <div
                  className="absolute bottom-0 left-0 right-0 rounded-sm bg-led-amber/40 transition-all"
                  style={{ height: `${(step.velocity / 127) * 100}%` }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-[7px] font-mono-synth text-synth-panel-foreground/60">
                  {step.velocity}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MelodySequencer;
