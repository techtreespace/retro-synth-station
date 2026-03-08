import React, { useCallback, useRef } from 'react';

interface WheelControlProps {
  value: number; // -1 to 1 for pitch bend, 0 to 1 for mod
  onChange: (value: number) => void;
  label: string;
  centered?: boolean; // true = springs back to 0
}

const WheelControl: React.FC<WheelControlProps> = ({
  value, onChange, label, centered = false,
}) => {
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null);
  const height = 80;

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
    const range = centered ? 2 : 1;
    const sensitivity = range / height;
    let newVal = dragRef.current.startVal + dy * sensitivity;
    newVal = centered
      ? Math.max(-1, Math.min(1, newVal))
      : Math.max(0, Math.min(1, newVal));
    onChange(newVal);
  }, [centered, onChange]);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    if (centered) onChange(0); // spring back
  }, [centered, onChange]);

  const fill = centered
    ? 50 + value * 50
    : value * 100;

  return (
    <div className="flex flex-col items-center gap-1 select-none touch-manipulation">
      <div
        className="relative w-6 rounded-sm bg-synth-surface-dark border border-synth-panel-border cursor-grab active:cursor-grabbing overflow-hidden"
        style={{ height }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Fill indicator */}
        <div
          className="absolute left-0 right-0 transition-none"
          style={{
            bottom: centered ? '50%' : 0,
            height: centered ? `${Math.abs(value) * 50}%` : `${fill}%`,
            transform: centered && value < 0 ? 'translateY(100%)' : undefined,
            background: `linear-gradient(to top, hsl(var(--led-amber) / 0.7), hsl(var(--led-amber-glow) / 0.5))`,
          }}
        />
        {/* Center line for pitch bend */}
        {centered && (
          <div className="absolute left-0 right-0 top-1/2 h-px bg-synth-panel-foreground/30" />
        )}
        {/* Thumb groove lines */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="absolute left-1 right-1 h-px bg-synth-panel-foreground/10"
            style={{ top: `${(i + 1) * 11}%` }}
          />
        ))}
      </div>
      <span className="text-[9px] font-mono-synth text-synth-panel-foreground uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
};

export default WheelControl;
