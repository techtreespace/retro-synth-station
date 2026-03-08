import React, { useCallback, useRef } from 'react';

interface VerticalSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  onChange: (value: number) => void;
  height?: number;
}

const VerticalSlider: React.FC<VerticalSliderProps> = ({
  value, min, max, step = 0.01, label, onChange, height = 80,
}) => {
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const fill = ((value - min) / (max - min)) * 100;

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
    const sensitivity = (max - min) / height;
    let newVal = dragRef.current.startVal + dy * sensitivity;
    newVal = Math.round(newVal / step) * step;
    newVal = Math.max(min, Math.min(max, newVal));
    onChange(newVal);
  }, [min, max, step, height, onChange]);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  return (
    <div className="flex flex-col items-center gap-1 select-none touch-manipulation">
      <div
        ref={trackRef}
        className="relative rounded-sm bg-synth-surface-dark cursor-grab active:cursor-grabbing"
        style={{ width: 12, height }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Fill */}
        <div
          className="absolute bottom-0 left-0 right-0 rounded-sm"
          style={{
            height: `${fill}%`,
            background: `linear-gradient(to top, hsl(var(--led-amber)), hsl(var(--led-amber-glow)))`,
          }}
        />
        {/* Thumb */}
        <div
          className="absolute left-1/2 -translate-x-1/2 w-5 h-3 rounded-sm bg-secondary border border-border"
          style={{ bottom: `calc(${fill}% - 6px)` }}
        />
      </div>
      <span className="text-[9px] font-mono-synth text-synth-panel-foreground uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
};

export default VerticalSlider;
