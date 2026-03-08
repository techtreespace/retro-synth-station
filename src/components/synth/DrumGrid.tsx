import React, { useCallback } from 'react';
import { DrumSound, DRUM_SOUNDS, DrumSoundParams, DRUM_PARAM_DEFS } from '@/audio/DrumEngine';
import { DrumPattern } from '@/audio/SequencerEngine';
import Knob from './Knob';

interface DrumGridProps {
  pattern: DrumPattern;
  currentStep: number;
  playing: boolean;
  patternLength: number;
  trackVolumes: Record<DrumSound, number>;
  trackParams: Record<DrumSound, DrumSoundParams>;
  onToggleStep: (track: number, step: number) => void;
  onToggleMute: (track: number) => void;
  onTrackVolumeChange: (sound: DrumSound, volume: number) => void;
  onTrackParamChange: (sound: DrumSound, params: DrumSoundParams) => void;
}

const DrumGrid: React.FC<DrumGridProps> = ({
  pattern, currentStep, playing, patternLength,
  trackVolumes, trackParams, onToggleStep, onToggleMute, onTrackVolumeChange, onTrackParamChange,
}) => {
  const handleStep = useCallback((track: number, step: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    onToggleStep(track, step);
  }, [onToggleStep]);

  return (
    <div className="space-y-1 overflow-x-auto">
      {DRUM_SOUNDS.map((sound, trackIdx) => {
        const def = DRUM_PARAM_DEFS[sound.id];
        const params = trackParams[sound.id];

        return (
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

            {/* Separator */}
            <div className="w-px h-6 bg-synth-panel-border/40 flex-shrink-0 mx-1" />

            {/* Per-sound knobs */}
            <div className="flex gap-1 flex-shrink-0">
              <Knob
                value={params.param1}
                min={def.min1}
                max={def.max1}
                step={def.max1 > 1000 ? 100 : def.max1 > 100 ? 1 : 0.01}
                label={def.label1}
                onChange={(v) => onTrackParamChange(sound.id, { ...params, param1: v })}
                size="sm"
                formatValue={(v) => def.max1 > 1000 ? `${(v/1000).toFixed(1)}k` : v >= 10 ? v.toFixed(0) : v.toFixed(2)}
              />
              <Knob
                value={params.param2}
                min={def.min2}
                max={def.max2}
                step={def.max2 > 10 ? 1 : 0.01}
                label={def.label2}
                onChange={(v) => onTrackParamChange(sound.id, { ...params, param2: v })}
                size="sm"
                formatValue={(v) => def.max2 > 10 ? v.toFixed(0) : v.toFixed(2)}
              />
              <Knob
                value={params.param3}
                min={def.min3}
                max={def.max3}
                step={def.max3 > 10 ? 1 : 0.01}
                label={def.label3}
                onChange={(v) => onTrackParamChange(sound.id, { ...params, param3: v })}
                size="sm"
                formatValue={(v) => def.max3 > 10 ? v.toFixed(0) : v.toFixed(2)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default DrumGrid;