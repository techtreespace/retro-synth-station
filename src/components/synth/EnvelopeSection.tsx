import React from 'react';
import VerticalSlider from './VerticalSlider';
import { ADSRParams } from '@/audio/SynthEngine';

interface EnvelopeSectionProps {
  adsr: ADSRParams;
  onChange: (adsr: ADSRParams) => void;
  label?: string;
}

const EnvelopeSection: React.FC<EnvelopeSectionProps> = ({ adsr, onChange, label = 'Envelope' }) => {
  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-display text-led-amber uppercase tracking-widest">{label}</h3>
      <div className="flex gap-3">
        <VerticalSlider
          value={adsr.attack} min={0.001} max={2} step={0.001}
          label="A"
          height={70}
          onChange={(v) => onChange({ ...adsr, attack: v })}
        />
        <VerticalSlider
          value={adsr.decay} min={0.001} max={2} step={0.001}
          label="D"
          height={70}
          onChange={(v) => onChange({ ...adsr, decay: v })}
        />
        <VerticalSlider
          value={adsr.sustain} min={0} max={1} step={0.01}
          label="S"
          height={70}
          onChange={(v) => onChange({ ...adsr, sustain: v })}
        />
        <VerticalSlider
          value={adsr.release} min={0.001} max={4} step={0.001}
          label="R"
          height={70}
          onChange={(v) => onChange({ ...adsr, release: v })}
        />
      </div>
    </div>
  );
};

export default EnvelopeSection;
