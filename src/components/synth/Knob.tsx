import React, { useCallback, useRef } from 'react';

interface KnobProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  onChange: (value: number) => void;
  size?: 'sm' | 'md' | 'lg';
  formatValue?: (v: number) => string;
}

const SIZES = { sm: 40, md: 52, lg: 64 };

const Knob: React.FC<KnobProps> = ({
  value, min, max, step = 0.01, label, onChange, size = 'md', formatValue,
}) => {
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null);
  const px = SIZES[size];
  const rotation = ((value - min) / (max - min)) * 270 - 135; // -135 to 135 degrees

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startVal: value };
  }, [value]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    const dy = dragRef.current.startY - e.clientY;
    const range = max - min;
    const sensitivity = range / 150;
    let newVal = dragRef.current.startVal + dy * sensitivity;
    newVal = Math.round(newVal / step) * step;
    newVal = Math.max(min, Math.min(max, newVal));
    onChange(newVal);
  }, [min, max, step, onChange]);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const displayValue = formatValue ? formatValue(value) : value.toFixed(step >= 1 ? 0 : 2);

  return (
    <div className="flex flex-col items-center gap-1 select-none touch-manipulation">
      <div
        className="relative rounded-full bg-knob-body knob-shadow cursor-grab active:cursor-grabbing"
        style={{ width: px, height: px }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Outer ring */}
        <div
          className="absolute inset-0.5 rounded-full border-2 border-knob-ring"
        />
        {/* Indicator line */}
        <div
          className="absolute top-1/2 left-1/2 origin-bottom"
          style={{
            width: 3,
            height: px / 2 - 6,
            transform: `translate(-50%, -100%) rotate(${rotation}deg)`,
            transformOrigin: 'bottom center',
          }}
        >
          <div
            className="w-full rounded-full bg-knob-indicator"
            style={{ height: px / 4 }}
          />
        </div>
        {/* Center dot */}
        <div className="absolute top-1/2 left-1/2 w-2 h-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-synth-panel-border" />
      </div>
      <span className="text-[10px] font-mono-synth text-synth-panel-foreground leading-none">
        {displayValue}
      </span>
      <span className="text-[9px] font-mono-synth text-muted-foreground uppercase tracking-wider leading-none">
        {label}
      </span>
    </div>
  );
};

export default Knob;
