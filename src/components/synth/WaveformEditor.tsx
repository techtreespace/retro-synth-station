import React, { useRef, useEffect, useCallback, useState } from 'react';

interface WaveformEditorProps {
  waveformData: number[];
  startOffsetRatio: number; // 0-1 ratio within buffer duration
  bufferDuration: number; // seconds
  onStartOffsetChange: (offsetSeconds: number) => void;
}

const WaveformEditor: React.FC<WaveformEditorProps> = ({
  waveformData,
  startOffsetRatio,
  bufferDuration,
  onStartOffsetChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [markerRatio, setMarkerRatio] = useState(startOffsetRatio);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (!isDragging) setMarkerRatio(startOffsetRatio);
  }, [startOffsetRatio, isDragging]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = 'hsl(220, 10%, 14%)';
    ctx.fillRect(0, 0, w, h);

    if (waveformData.length === 0) {
      ctx.fillStyle = 'hsla(35, 30%, 85%, 0.4)';
      ctx.font = '8px "Share Tech Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('NO DATA', w / 2, h / 2 + 3);
      return;
    }

    const barCount = waveformData.length;
    const barWidth = w / barCount;
    const markerX = markerRatio * w;

    // Draw waveform bars
    for (let i = 0; i < barCount; i++) {
      const x = i * barWidth;
      const barH = Math.max(waveformData[i] * (h - 12), 2);
      const isBeforeMarker = x + barWidth < markerX;

      if (isBeforeMarker) {
        ctx.fillStyle = 'hsla(35, 100%, 55%, 0.35)'; // dimmed
      } else {
        ctx.fillStyle = 'hsla(35, 100%, 55%, 0.75)'; // full
      }
      ctx.fillRect(x + 0.5, h - barH, barWidth - 1, barH);
    }

    // Draw marker line
    const lineColor = draggingRef.current ? 'hsl(35, 100%, 55%)' : 'white';
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(markerX, 0);
    ctx.lineTo(markerX, h);
    ctx.stroke();

    // Draw triangle handle at top
    ctx.fillStyle = lineColor;
    ctx.beginPath();
    ctx.moveTo(markerX, 0);
    ctx.lineTo(markerX - 5, 8);
    ctx.lineTo(markerX + 5, 8);
    ctx.closePath();
    ctx.fill();
  }, [waveformData, markerRatio]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  const getRatioFromEvent = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  }, []);

  const applyOffset = useCallback((ratio: number) => {
    onStartOffsetChange(ratio * bufferDuration);
  }, [onStartOffsetChange, bufferDuration]);

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const ratio = getRatioFromEvent(e.clientX);
    setMarkerRatio(ratio);
    setIsDragging(true);
    draggingRef.current = true;
  }, [getRatioFromEvent]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const ratio = getRatioFromEvent(e.clientX);
      setMarkerRatio(ratio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      draggingRef.current = false;
      setMarkerRatio(prev => {
        applyOffset(prev);
        return prev;
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, getRatioFromEvent, applyOffset]);

  // Touch handlers — fully manual, preventDefault on all
  const handleTouchStart = useCallback((e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length !== 1) return;
    const ratio = getRatioFromEvent(e.touches[0].clientX);
    setMarkerRatio(ratio);
    setIsDragging(true);
    draggingRef.current = true;
  }, [getRatioFromEvent]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length !== 1) return;
    const ratio = getRatioFromEvent(e.touches[0].clientX);
    setMarkerRatio(ratio);
  }, [getRatioFromEvent]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    e.preventDefault();
    setIsDragging(false);
    draggingRef.current = false;
    setMarkerRatio(prev => {
      applyOffset(prev);
      return prev;
    });
  }, [applyOffset]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  const offsetMs = Math.round(markerRatio * bufferDuration * 1000);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="w-full h-10 rounded cursor-crosshair"
        style={{ touchAction: 'none' }}
        onMouseDown={handleMouseDown}
      />
      {bufferDuration > 0 && (
        <span className="absolute bottom-0 right-1 font-mono-synth text-[7px] text-synth-panel-foreground/60">
          +{offsetMs}ms
        </span>
      )}
    </div>
  );
};

export default WaveformEditor;
