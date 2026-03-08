import React, { useCallback, useEffect, useRef } from 'react';

interface KeyboardProps {
  octave: number;
  onNoteOn: (note: number) => void;
  onNoteOff: (note: number) => void;
  onOctaveChange: (octave: number) => void;
  onReleaseAll: () => void;
  activeNotes: Set<number>;
  mobileMode?: boolean;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const WHITE_INDICES = [0, 2, 4, 5, 7, 9, 11];
const BLACK_INDICES = [1, 3, 6, 8, 10];
const BLACK_POSITIONS: Record<number, number> = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 };

const KEY_MAP: Record<string, number> = {
  'a': 0,   // C
  'w': 1,   // C#
  's': 2,   // D
  'e': 3,   // D#
  'd': 4,   // E
  'f': 5,   // F
  't': 6,   // F#
  'g': 7,   // G
  'y': 8,   // G#
  'h': 9,   // A
  'u': 10,  // A#
  'j': 11,  // B
  'k': 12,  // C (octave+1)
  'o': 13,  // C# (octave+1)
  'l': 14,  // D (octave+1)
  'p': 15,  // D# (octave+1)
  ';': 16,  // E (octave+1)
};

const Keyboard: React.FC<KeyboardProps> = ({
  octave, onNoteOn, onNoteOff, onOctaveChange, onReleaseAll, activeNotes, mobileMode = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const touchNotes = useRef<Map<number, number>>(new Map());
  const mouseNote = useRef<number | null>(null);
  const mouseDown = useRef(false);
  const heldKeys = useRef<Set<string>>(new Set());
  const onNoteOnRef = useRef(onNoteOn);
  const onNoteOffRef = useRef(onNoteOff);
  const onReleaseAllRef = useRef(onReleaseAll);
  const baseNoteRef = useRef((octave + 2) * 12);
  const octaveRef = useRef(octave);
  const onOctaveChangeRef = useRef(onOctaveChange);

  onNoteOnRef.current = onNoteOn;
  onNoteOffRef.current = onNoteOff;
  onReleaseAllRef.current = onReleaseAll;
  baseNoteRef.current = (octave + 2) * 12;
  octaveRef.current = octave;
  onOctaveChangeRef.current = onOctaveChange;

  const baseNote = (octave + 2) * 12;

  // Keyboard + global release handlers — added ONCE
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (heldKeys.current.has(key)) return;

      if (key === 'z') { onOctaveChangeRef.current(Math.max(-2, octaveRef.current - 1)); return; }
      if (key === 'x') { onOctaveChangeRef.current(Math.min(4, octaveRef.current + 1)); return; }

      if (KEY_MAP[key] !== undefined) {
        heldKeys.current.add(key);
        const note = baseNoteRef.current + KEY_MAP[key];
        onNoteOnRef.current(note);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (KEY_MAP[key] !== undefined && heldKeys.current.has(key)) {
        heldKeys.current.delete(key);
        const note = baseNoteRef.current + KEY_MAP[key];
        onNoteOffRef.current(note);
      }
    };

    const handleGlobalMouseUp = () => {
      if (mouseNote.current !== null) {
        onNoteOffRef.current(mouseNote.current);
        mouseNote.current = null;
      }
      mouseDown.current = false;
    };

    const handleBlur = () => {
      onReleaseAllRef.current();
      mouseNote.current = null;
      mouseDown.current = false;
      touchNotes.current.clear();
      heldKeys.current.clear();
    };

    const handleVisibility = () => { if (document.hidden) handleBlur(); };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Touch handlers
  const getNoteFromTouch = useCallback((x: number, y: number): number | null => {
    const elements = document.elementsFromPoint(x, y);
    for (const el of elements) {
      const noteAttr = el.getAttribute('data-note');
      if (noteAttr) return parseInt(noteAttr);
    }
    return null;
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const note = getNoteFromTouch(touch.clientX, touch.clientY);
      if (note !== null) {
        touchNotes.current.set(touch.identifier, note);
        onNoteOn(note);
      }
    }
  }, [getNoteFromTouch, onNoteOn]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const note = getNoteFromTouch(touch.clientX, touch.clientY);
      const prevNote = touchNotes.current.get(touch.identifier);
      if (note !== null && note !== prevNote) {
        if (prevNote !== undefined) onNoteOff(prevNote);
        touchNotes.current.set(touch.identifier, note);
        onNoteOn(note);
      }
    }
  }, [getNoteFromTouch, onNoteOn, onNoteOff]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const note = touchNotes.current.get(touch.identifier);
      if (note !== undefined) {
        onNoteOff(note);
        touchNotes.current.delete(touch.identifier);
      }
    }
  }, [onNoteOff]);

  const handleMouseDown = useCallback((note: number) => {
    mouseDown.current = true;
    mouseNote.current = note;
    onNoteOn(note);
  }, [onNoteOn]);

  const handleMouseEnter = useCallback((note: number) => {
    if (mouseDown.current) {
      if (mouseNote.current !== null && mouseNote.current !== note) {
        onNoteOff(mouseNote.current);
      }
      mouseNote.current = note;
      onNoteOn(note);
    }
  }, [onNoteOn, onNoteOff]);

  // Generate keys: 1 octave for mobile, 2 for desktop
  const numOctaves = mobileMode ? 1 : 2;
  const whiteKeys: { note: number; name: string }[] = [];
  const blackKeys: { note: number; name: string; position: number }[] = [];

  for (let oct = 0; oct < numOctaves; oct++) {
    for (const idx of WHITE_INDICES) whiteKeys.push({ note: baseNote + oct * 12 + idx, name: NOTE_NAMES[idx] });
    for (const idx of BLACK_INDICES) blackKeys.push({ note: baseNote + oct * 12 + idx, name: NOTE_NAMES[idx], position: BLACK_POSITIONS[idx] + oct * 7 });
  }

  const whiteKeyWidth = 100 / whiteKeys.length;
  const keyHeight = mobileMode ? 110 : 140;

  return (
    <div className="w-full select-none">
      <div className="flex items-center justify-between px-2 py-1">
        <button
          onClick={() => onOctaveChange(Math.max(-2, octave - 1))}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded bg-synth-panel text-synth-panel-foreground font-mono-synth text-sm border border-synth-panel-border active:bg-synth-panel-border"
        >
          OCT −
        </button>
        <span className="font-mono-synth text-xs text-foreground">
          C{octave + 3}{mobileMode ? '' : ` – B${octave + 4}`}
        </span>
        <button
          onClick={() => onOctaveChange(Math.min(4, octave + 1))}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded bg-synth-panel text-synth-panel-foreground font-mono-synth text-sm border border-synth-panel-border active:bg-synth-panel-border"
        >
          OCT +
        </button>
      </div>

      <div
        ref={containerRef}
        className="relative w-full"
        style={{ height: keyHeight, touchAction: 'none' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div className="relative h-full w-full">
          {whiteKeys.map((key, i) => {
            const isActive = activeNotes.has(key.note);
            return (
              <div
                key={key.note}
                data-note={key.note}
                className={`absolute top-0 bottom-0 border-r border-border rounded-b-md flex items-end justify-center pb-2 cursor-pointer transition-colors duration-75
                  ${isActive ? 'bg-key-white-active led-glow-sm' : 'bg-key-white hover:brightness-95'}`}
                style={{ left: `${i * whiteKeyWidth}%`, width: `${whiteKeyWidth}%` }}
                onMouseDown={(e) => { e.preventDefault(); handleMouseDown(key.note); }}
                onMouseEnter={() => handleMouseEnter(key.note)}
              >
                <span className="text-[10px] font-mono-synth text-foreground/50 pointer-events-none">{key.name}</span>
              </div>
            );
          })}
          {blackKeys.map((key) => {
            const isActive = activeNotes.has(key.note);
            return (
              <div
                key={key.note}
                data-note={key.note}
                className={`absolute top-0 rounded-b-md cursor-pointer z-10 transition-colors duration-75
                  ${isActive ? 'bg-key-black-active led-glow-sm' : 'bg-key-black hover:brightness-125'}`}
                style={{ left: `${(key.position + 0.65) * whiteKeyWidth}%`, width: `${whiteKeyWidth * 0.65}%`, height: '60%' }}
                onMouseDown={(e) => { e.preventDefault(); handleMouseDown(key.note); }}
                onMouseEnter={() => handleMouseEnter(key.note)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Keyboard;
