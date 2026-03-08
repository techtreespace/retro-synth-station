import React from 'react';
import Knob from './Knob';
import { FilterType, SynthParams } from '@/audio/SynthEngine';

interface FilterSectionProps {
  params: SynthParams;
  onChange: (params: Partial<SynthParams>) => void;
}

const FILTER_TYPES: { value: FilterType; label: string }[] = [
  { value: 'lowpass', label: 'LP' },
  { value: 'highpass', label: 'HP' },
  { value: 'bandpass', label: 'BP' },
];

const FilterSection: React.FC<FilterSectionProps> = ({ params, onChange }) => {
  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-display text-led-amber uppercase tracking-widest">Filter</h3>
      <div className="flex gap-1 mb-2">
        {FILTER_TYPES.map(f => (
          <button
            key={f.value}
            onClick={() => onChange({ filterType: f.value })}
            className={`min-w-[44px] min-h-[36px] px-2 py-1 rounded text-[10px] font-mono-synth border transition-colors
              ${params.filterType === f.value
                ? 'bg-led-amber/20 text-led-amber border-led-amber led-glow-sm'
                : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border'
              }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex gap-3">
        <Knob
          value={params.filterCutoff}
          min={20} max={20000} step={1}
          label="Cutoff"
          onChange={(v) => onChange({ filterCutoff: v })}
          size="sm"
          formatValue={(v) => v < 1000 ? `${Math.round(v)}` : `${(v/1000).toFixed(1)}k`}
        />
        <Knob
          value={params.filterResonance}
          min={0} max={30} step={0.1}
          label="Reso"
          onChange={(v) => onChange({ filterResonance: v })}
          size="sm"
        />
      </div>
    </div>
  );
};

export default FilterSection;
