import React, { useCallback } from 'react';
import { DrumSound, DRUM_SOUNDS } from '@/audio/DrumEngine';
import { DrumPattern } from '@/audio/SequencerEngine';
import Knob from './Knob';

interface DrumGridProps {
  pattern: DrumPattern;
  currentStep: number;
  playing: boolean;
  patternLength: number;
  trackVolumes: Record<DrumSound, number>;
  onToggleStep: (track: number, step: number) => void;
  onToggleMute: (track: number) => void;
  onTrackVolumeChange: (sound: DrumSound, volume: number) => void;
}

const DrumGrid: React.FC<DrumGridProps> = ({
  pattern, currentStep, playing, patternLength,
  trackVolumes, onToggleStep, onToggleMute, onTrackVolumeChange,
}) => {
  const handleStep = useCallback((track: number, step: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    onToggleStep(track, step);
  }, [onToggleStep]);

  return (
    <div className="space-y-1 overflow-x-auto">
      {DRUM_SOUNDS.map((sound, trackIdx) => (
        <div key={sound.id} className="flex items-center gap-1">
          {/* Track label */}
          <span className={`w-10 text-[9px] font-mono-synth tracking-wider flex-shrink-0 ${
            pattern.muted[trackIdx] ? 'text-muted-foreground line-through' : 'text-led-amber'
          }`}>
            {sound.label}
          </span>

          {/* Steps */}
          <div className="flex gap-[2px] flex-shrink-0">
            {Array.from({ length: patternLength }, (_, stepIdx) => {
              const active = pattern.steps[trackIdx]?.[stepIdx] ?? false;
              const isCurrent = playing && currentStep === stepIdx;
              const isDownbeat = stepIdx % 4 === 0;

              return (
                <button
                  key={stepIdx}
                  onPointerDown={handleStep(trackIdx, stepIdx)}
                  className={`
                    min-w-[28px] min-h-[28px] md:min-w-[32px] md:min-h-[32px] rounded-sm
                    border transition-all duration-75 touch-manipulation
                    ${active
                      ? 'bg-led-amber/30 border-led-amber led-glow-sm'
                      : isDownbeat
                        ? 'bg-synth-surface-dark/80 border-synth-panel-border/60'
                        : 'bg-synth-surface-dark/50 border-synth-panel-border/30'
                    }
                    ${isCurrent ? 'ring-2 ring-accent ring-offset-0' : ''}
                    hover:border-synth-panel-foreground/40
                  `}
                  style={{ pointerEvents: 'auto' }}
                />
              );
            })}
          </div>

          {/* Track volume */}
          <div className="flex-shrink-0 ml-1">
            <Knob
              value={trackVolumes[sound.id]}
              min={0}
              max={1}
              label=""
              onChange={(v) => onTrackVolumeChange(sound.id, v)}
              size="sm"
            />
          </div>

          {/* Mute button */}
          <button
            onClick={() => onToggleMute(trackIdx)}
            className={`min-w-[28px] min-h-[28px] rounded text-[9px] font-display border transition-colors flex-shrink-0
              ${pattern.muted[trackIdx]
                ? 'bg-led-red/30 border-led-red text-led-red'
                : 'bg-synth-surface-dark/50 border-synth-panel-border text-synth-panel-foreground/60 hover:border-synth-panel-foreground/40'
              }`}
          >
            M
          </button>
        </div>
      ))}
    </div>
  );
};

export default DrumGrid;
