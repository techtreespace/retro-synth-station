import React, { useRef, useEffect, useCallback, useState } from 'react';

interface WaveformEditorProps {
  waveformData: number[];
  startOffsetRatio: number;
  endOffsetRatio: number;
  fadeInRatio: number;
  fadeOutRatio: number;
  bufferDuration: number;
  syncToBpm: boolean;
  bpm: number;
  isPlaying: boolean;
  onStartOffsetChange: (offsetSeconds: number) => void;
  onEndOffsetChange: (offsetSeconds: number) => void;
  onFadeInChange: (seconds: number) => void;
  onFadeOutChange: (seconds: number) => void;
}

type HandleType = 'start' | 'fadeIn' | 'fadeOut' | 'end' | null;

const HANDLE_W = 12;
const HANDLE_H = 10;
const GRAB_RADIUS = 20; // touch target px

const WaveformEditor: React.FC<WaveformEditorProps> = ({
  waveformData,
  startOffsetRatio,
  endOffsetRatio,
  fadeInRatio,
  fadeOutRatio,
  bufferDuration,
  syncToBpm,
  bpm,
  isPlaying,
  onStartOffsetChange,
  onEndOffsetChange,
  onFadeInChange,
  onFadeOutChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState<HandleType>(null);
  const draggingRef = useRef<HandleType>(null);

  // Local ratios for smooth dragging
  const [localStart, setLocalStart] = useState(startOffsetRatio);
  const [localEnd, setLocalEnd] = useState(endOffsetRatio);
  const [localFadeIn, setLocalFadeIn] = useState(fadeInRatio);
  const [localFadeOut, setLocalFadeOut] = useState(fadeOutRatio);

  // Sync from props when not dragging
  useEffect(() => {
    if (!draggingRef.current) {
      setLocalStart(startOffsetRatio);
      setLocalEnd(endOffsetRatio);
      setLocalFadeIn(fadeInRatio);
      setLocalFadeOut(fadeOutRatio);
    }
  }, [startOffsetRatio, endOffsetRatio, fadeInRatio, fadeOutRatio]);

  const getSnappedEndRatio = useCallback((endRatio: number, startRatio: number): number => {
    if (!syncToBpm || bufferDuration <= 0) return endRatio;
    const barDuration = (60 / bpm) * 4;
    const startSec = startRatio * bufferDuration;
    const endSec = endRatio * bufferDuration;
    const loopDuration = endSec - startSec;
    const nearestBars = Math.max(1, Math.round(loopDuration / barDuration));
    const snappedDuration = nearestBars * barDuration;
    const snappedEnd = Math.min(startSec + snappedDuration, bufferDuration);
    return snappedEnd / bufferDuration;
  }, [syncToBpm, bpm, bufferDuration]);

  const getBarCount = useCallback((startR: number, endR: number): number => {
    if (bufferDuration <= 0) return 0;
    const barDuration = (60 / bpm) * 4;
    const loopDuration = (endR - startR) * bufferDuration;
    return Math.max(1, Math.round(loopDuration / barDuration));
  }, [bpm, bufferDuration]);

  // ─── DRAWING ──────────────────────────────────────────────────
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

    const startX = localStart * w;
    const endX = localEnd * w;
    const fadeInEndX = startX + localFadeIn * w;
    const fadeOutStartX = endX - localFadeOut * w;
    const barCount = waveformData.length;
    const barWidth = w / barCount;

    // Draw waveform bars with region coloring
    for (let i = 0; i < barCount; i++) {
      const x = i * barWidth;
      const barH = Math.max(waveformData[i] * (h - 14), 2);
      const barCenter = x + barWidth / 2;

      if (barCenter < startX || barCenter > endX) {
        ctx.fillStyle = 'hsla(35, 100%, 55%, 0.2)'; // dimmed outside
      } else if (barCenter < fadeInEndX) {
        ctx.fillStyle = 'hsla(120, 60%, 50%, 0.6)'; // green fade in
      } else if (barCenter > fadeOutStartX) {
        ctx.fillStyle = 'hsla(35, 100%, 55%, 0.5)'; // amber fade out
      } else {
        ctx.fillStyle = 'hsla(35, 100%, 55%, 0.75)'; // full brightness
      }
      ctx.fillRect(x + 0.5, h - barH, barWidth - 1, barH);
    }

    // Fade in overlay
    if (localFadeIn > 0.001) {
      const grad = ctx.createLinearGradient(startX, 0, fadeInEndX, 0);
      grad.addColorStop(0, 'hsla(120, 60%, 45%, 0.2)');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(startX, 0, fadeInEndX - startX, h);
    }

    // Fade out overlay
    if (localFadeOut > 0.001) {
      const grad = ctx.createLinearGradient(fadeOutStartX, 0, endX, 0);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(1, 'hsla(35, 100%, 55%, 0.2)');
      ctx.fillStyle = grad;
      ctx.fillRect(fadeOutStartX, 0, endX - fadeOutStartX, h);
    }

    // ─── Handles ─────────────────────────────────────────────
    const isDraggingHandle = draggingRef.current;

    // START marker (white line + triangle)
    const startColor = isDraggingHandle === 'start' ? 'hsl(35, 100%, 55%)' : 'white';
    ctx.strokeStyle = startColor;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(startX, 0); ctx.lineTo(startX, h); ctx.stroke();
    ctx.fillStyle = startColor;
    ctx.beginPath();
    ctx.moveTo(startX, 0); ctx.lineTo(startX - 6, HANDLE_H); ctx.lineTo(startX + 6, HANDLE_H);
    ctx.closePath(); ctx.fill();

    // END marker (white line + triangle)
    const endColor = isDraggingHandle === 'end'
      ? 'hsl(35, 100%, 55%)'
      : (syncToBpm ? 'hsl(35, 100%, 55%)' : 'white');
    ctx.strokeStyle = endColor;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(endX, 0); ctx.lineTo(endX, h); ctx.stroke();
    ctx.fillStyle = endColor;
    ctx.beginPath();
    ctx.moveTo(endX, 0); ctx.lineTo(endX - 6, HANDLE_H); ctx.lineTo(endX + 6, HANDLE_H);
    ctx.closePath(); ctx.fill();

    // FADE IN handle (green triangle on top edge)
    if (localFadeIn > 0.001) {
      ctx.fillStyle = isDraggingHandle === 'fadeIn' ? 'hsl(120, 80%, 60%)' : 'hsl(120, 60%, 50%)';
      ctx.beginPath();
      ctx.moveTo(fadeInEndX, 0); ctx.lineTo(fadeInEndX - 6, HANDLE_H); ctx.lineTo(fadeInEndX + 6, HANDLE_H);
      ctx.closePath(); ctx.fill();
    }

    // FADE OUT handle (amber triangle on top edge)
    if (localFadeOut > 0.001) {
      ctx.fillStyle = isDraggingHandle === 'fadeOut' ? 'hsl(35, 100%, 70%)' : 'hsl(35, 100%, 55%)';
      ctx.beginPath();
      ctx.moveTo(fadeOutStartX, 0); ctx.lineTo(fadeOutStartX - 6, HANDLE_H); ctx.lineTo(fadeOutStartX + 6, HANDLE_H);
      ctx.closePath(); ctx.fill();
    }
  }, [waveformData, localStart, localEnd, localFadeIn, localFadeOut, syncToBpm]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  // ─── HIT TESTING ──────────────────────────────────────────────
  const getHandleAtX = useCallback((ratio: number, canvasW: number): HandleType => {
    const x = ratio * canvasW;
    const startX = localStart * canvasW;
    const endX = localEnd * canvasW;
    const fadeInEndX = startX + localFadeIn * canvasW;
    const fadeOutStartX = endX - localFadeOut * canvasW;

    // Priority: exact handle closest to click
    const distances: { handle: HandleType; dist: number }[] = [
      { handle: 'start', dist: Math.abs(x - startX) },
      { handle: 'end', dist: Math.abs(x - endX) },
      { handle: 'fadeIn', dist: Math.abs(x - fadeInEndX) },
      { handle: 'fadeOut', dist: Math.abs(x - fadeOutStartX) },
    ];
    distances.sort((a, b) => a.dist - b.dist);
    if (distances[0].dist < GRAB_RADIUS) return distances[0].handle;
    return null;
  }, [localStart, localEnd, localFadeIn, localFadeOut]);

  const getRatioFromClientX = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const moveHandle = useCallback((handle: HandleType, ratio: number) => {
    if (!handle) return;
    const MIN_REGION = 0.02; // minimum region size ratio

    switch (handle) {
      case 'start': {
        const clamped = Math.max(0, Math.min(ratio, localEnd - MIN_REGION));
        setLocalStart(clamped);
        // Adjust fadeIn if it would exceed region
        if (localFadeIn > localEnd - clamped - localFadeOut) {
          setLocalFadeIn(Math.max(0, localEnd - clamped - localFadeOut));
        }
        break;
      }
      case 'end': {
        const clamped = Math.max(localStart + MIN_REGION, Math.min(ratio, 1));
        setLocalEnd(clamped);
        // Adjust fadeOut if it would exceed region
        if (localFadeOut > clamped - localStart - localFadeIn) {
          setLocalFadeOut(Math.max(0, clamped - localStart - localFadeIn));
        }
        break;
      }
      case 'fadeIn': {
        const fadeEndRatio = ratio - localStart;
        const maxFade = localEnd - localStart - localFadeOut;
        setLocalFadeIn(Math.max(0, Math.min(fadeEndRatio, maxFade)));
        break;
      }
      case 'fadeOut': {
        const fadeRatio = localEnd - ratio;
        const maxFade = localEnd - localStart - localFadeIn;
        setLocalFadeOut(Math.max(0, Math.min(fadeRatio, maxFade)));
        break;
      }
    }
  }, [localStart, localEnd, localFadeIn, localFadeOut]);

  const applyChanges = useCallback(() => {
    if (bufferDuration <= 0) return;
    let finalEnd = localEnd;
    if (syncToBpm) {
      finalEnd = getSnappedEndRatio(localEnd, localStart);
      setLocalEnd(finalEnd);
    }
    onStartOffsetChange(localStart * bufferDuration);
    onEndOffsetChange(finalEnd * bufferDuration);
    onFadeInChange(localFadeIn * bufferDuration);
    onFadeOutChange(localFadeOut * bufferDuration);
  }, [localStart, localEnd, localFadeIn, localFadeOut, bufferDuration, syncToBpm, getSnappedEndRatio, onStartOffsetChange, onEndOffsetChange, onFadeInChange, onFadeOutChange]);

  // ─── MOUSE HANDLERS ──────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = getRatioFromClientX(e.clientX);
    const handle = getHandleAtX(ratio, canvas.offsetWidth);
    if (handle) {
      setDragging(handle);
      draggingRef.current = handle;
    } else {
      // Click outside handles — move nearest of start/end
      const startDist = Math.abs(ratio - localStart);
      const endDist = Math.abs(ratio - localEnd);
      const nearest = startDist < endDist ? 'start' : 'end';
      moveHandle(nearest, ratio);
      setDragging(nearest);
      draggingRef.current = nearest;
    }
  }, [getRatioFromClientX, getHandleAtX, localStart, localEnd, moveHandle]);

  useEffect(() => {
    if (!dragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      moveHandle(draggingRef.current, getRatioFromClientX(e.clientX));
    };
    const handleMouseUp = () => {
      setDragging(null);
      draggingRef.current = null;
      applyChanges();
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, getRatioFromClientX, moveHandle, applyChanges]);

  // ─── TOUCH HANDLERS ──────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length !== 1) return;
      const ratio = getRatioFromClientX(e.touches[0].clientX);
      const handle = getHandleAtX(ratio, canvas.offsetWidth);
      if (handle) {
        setDragging(handle);
        draggingRef.current = handle;
      } else {
        const startDist = Math.abs(ratio - localStart);
        const endDist = Math.abs(ratio - localEnd);
        const nearest = startDist < endDist ? 'start' : 'end';
        moveHandle(nearest, ratio);
        setDragging(nearest);
        draggingRef.current = nearest;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length !== 1 || !draggingRef.current) return;
      moveHandle(draggingRef.current, getRatioFromClientX(e.touches[0].clientX));
    };

    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      setDragging(null);
      draggingRef.current = null;
      applyChanges();
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, [getRatioFromClientX, getHandleAtX, localStart, localEnd, moveHandle, applyChanges]);

  // ─── INFO TEXT ────────────────────────────────────────────────
  const startMs = Math.round(localStart * bufferDuration * 1000);
  const endMs = Math.round(localEnd * bufferDuration * 1000);
  const lengthSec = ((localEnd - localStart) * bufferDuration).toFixed(2);
  const barCount = getBarCount(localStart, localEnd);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="w-full h-12 rounded cursor-crosshair"
        style={{ touchAction: 'none' }}
        onMouseDown={handleMouseDown}
      />
      {bufferDuration > 0 && (
        <div className="flex justify-between mt-0.5 font-mono-synth text-[6px] text-synth-panel-foreground/50 px-0.5">
          <span>S:{startMs}ms</span>
          <span>E:{endMs}ms</span>
          <span>{lengthSec}s{syncToBpm ? ` ≈${barCount}bar` : ''}</span>
        </div>
      )}
    </div>
  );
};

export default WaveformEditor;
