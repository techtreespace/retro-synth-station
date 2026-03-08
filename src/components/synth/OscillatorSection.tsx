import React from 'react';
import Knob from './Knob';
import { SynthParams, WaveformType, WavetableType } from '@/audio/SynthEngine';

interface OscillatorSectionProps {
  params: SynthParams;
  onChange: (params: Partial<SynthParams>) => void;
}

const WAVEFORMS: { value: WaveformType; label: string }[] = [
  { value: 'sine', label: 'SIN' },
  { value: 'sawtooth', label: 'SAW' },
  { value: 'square', label: 'SQR' },
  { value: 'triangle', label: 'TRI' },
];

const WAVETABLES: { value: WavetableType; label: string }[] = [
  { value: 'basic', label: 'BASIC' },
  { value: 'strings', label: 'STR' },
  { value: 'vocal', label: 'VOC' },
  { value: 'metallic', label: 'MTL' },
  { value: 'pad', label: 'PAD' },
  { value: 'bass', label: 'BAS' },
  { value: 'lead', label: 'LED' },
  { value: 'noise', label: 'NSE' },
];

const RATIOS = [1, 2, 3, 4, 8];

const OscillatorSection: React.FC<OscillatorSectionProps> = ({ params, onChange }) => {
  if (params.type === 'analog') {
    return (
      <div className="space-y-2">
        <h3 className="text-[10px] font-display text-led-amber uppercase tracking-widest">Oscillator</h3>
        <div className="flex flex-wrap gap-1">
          {WAVEFORMS.map(w => (
            <button
              key={w.value}
              onClick={() => onChange({ waveform: w.value })}
              className={`min-w-[44px] min-h-[44px] px-2 py-1 rounded text-[10px] font-mono-synth border transition-colors
                ${params.waveform === w.value
                  ? 'bg-led-amber/20 text-led-amber border-led-amber led-glow-sm'
                  : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border'
                }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (params.type === 'wavetable') {
    return (
      <div className="space-y-2">
        <h3 className="text-[10px] font-display text-led-amber uppercase tracking-widest">Wavetable</h3>
        <div className="flex flex-wrap gap-1">
          {WAVETABLES.map(w => (
            <button
              key={w.value}
              onClick={() => onChange({ wavetableType: w.value })}
              className={`min-w-[44px] min-h-[44px] px-2 py-1 rounded text-[10px] font-mono-synth border transition-colors
                ${params.wavetableType === w.value
                  ? 'bg-led-amber/20 text-led-amber border-led-amber led-glow-sm'
                  : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border'
                }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <Knob
          value={params.wavetablePosition}
          min={0} max={1}
          label="Position"
          onChange={(v) => onChange({ wavetablePosition: v })}
          size="sm"
        />
      </div>
    );
  }

  // FM
  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-display text-led-amber uppercase tracking-widest">FM Synth</h3>
      <div className="flex flex-wrap gap-3">
        <Knob
          value={params.fmModIndex}
          min={0} max={10} step={0.1}
          label="Mod Index"
          onChange={(v) => onChange({ fmModIndex: v })}
          size="sm"
        />
        <Knob
          value={params.fmFeedback}
          min={0} max={1}
          label="Feedback"
          onChange={(v) => onChange({ fmFeedback: v })}
          size="sm"
        />
      </div>
      <div className="flex gap-4">
        <div>
          <span className="text-[9px] font-mono-synth text-muted-foreground">CARRIER</span>
          <div className="flex gap-1 mt-1">
            {RATIOS.map(r => (
              <button
                key={`c${r}`}
                onClick={() => onChange({ fmCarrierRatio: r })}
                className={`min-w-[32px] min-h-[32px] px-1.5 py-1 rounded text-[10px] font-mono-synth border
                  ${params.fmCarrierRatio === r
                    ? 'bg-led-amber/20 text-led-amber border-led-amber'
                    : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border'
                  }`}
              >
                {r}x
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="text-[9px] font-mono-synth text-muted-foreground">MODULATOR</span>
          <div className="flex gap-1 mt-1">
            {RATIOS.map(r => (
              <button
                key={`m${r}`}
                onClick={() => { console.log('MODULATOR CLICK', r, 'current:', params.fmModRatio); onChange({ fmModRatio: r }); }}
                className={`min-w-[32px] min-h-[32px] px-1.5 py-1 rounded text-[10px] font-mono-synth border
                  ${params.fmModRatio === r
                    ? 'bg-led-amber/20 text-led-amber border-led-amber'
                    : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border'
                  }`}
              >
                {r}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OscillatorSection;
