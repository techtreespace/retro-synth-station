import React from 'react';
import { PRESETS, Preset } from '@/audio/presets';

interface PresetSelectorProps {
  onSelect: (preset: Preset) => void;
  currentPreset: string | null;
}

const PresetSelector: React.FC<PresetSelectorProps> = ({ onSelect, currentPreset }) => {
  return (
    <select
      value={currentPreset || ''}
      onChange={(e) => {
        const preset = PRESETS.find(p => p.name === e.target.value);
        if (preset) onSelect(preset);
      }}
      className="min-h-[44px] px-3 py-2 rounded bg-synth-surface-dark text-synth-panel-foreground font-mono-synth text-xs border border-synth-panel-border appearance-none cursor-pointer w-full max-w-[200px]"
      style={{ backgroundImage: 'none' }}
    >
      <option value="" disabled>PRESETS</option>
      <optgroup label="— ANALOG —">
        {PRESETS.filter(p => p.category === 'analog').map(p => (
          <option key={p.name} value={p.name}>{p.name}</option>
        ))}
      </optgroup>
      <optgroup label="— WAVETABLE —">
        {PRESETS.filter(p => p.category === 'wavetable').map(p => (
          <option key={p.name} value={p.name}>{p.name}</option>
        ))}
      </optgroup>
      <optgroup label="— FM —">
        {PRESETS.filter(p => p.category === 'fm').map(p => (
          <option key={p.name} value={p.name}>{p.name}</option>
        ))}
      </optgroup>
    </select>
  );
};

export default PresetSelector;
