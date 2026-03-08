import React from 'react';
import Knob from './Knob';
import { LFOTarget, SynthParams } from '@/audio/SynthEngine';

interface LFOSectionProps {
  params: SynthParams;
  onChange: (params: Partial<SynthParams>) => void;
}

const LFO_TARGETS: { value: LFOTarget; label: string }[] = [
  { value: 'pitch', label: 'PITCH' },
  { value: 'filter', label: 'FILTER' },
];

const LFOSection: React.FC<LFOSectionProps> = ({ params, onChange }) => {
  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-display text-led-amber uppercase tracking-widest">LFO</h3>
      <div className="flex gap-1 mb-2">
        {LFO_TARGETS.map(t => (
          <button
            key={t.value}
            onClick={() => onChange({ lfoTarget: t.value })}
            className={`min-w-[44px] min-h-[36px] px-2 py-1 rounded text-[10px] font-mono-synth border transition-colors
              ${params.lfoTarget === t.value
                ? 'bg-led-amber/20 text-led-amber border-led-amber led-glow-sm'
                : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border'
              }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex gap-3">
        <Knob
          value={params.lfoRate}
          min={0.1} max={20} step={0.1}
          label="Rate"
          onChange={(v) => onChange({ lfoRate: v })}
          size="sm"
          formatValue={(v) => `${v.toFixed(1)}`}
        />
        <Knob
          value={params.lfoDepth}
          min={0} max={1}
          label="Depth"
          onChange={(v) => onChange({ lfoDepth: v })}
          size="sm"
        />
      </div>
    </div>
  );
};

export default LFOSection;
