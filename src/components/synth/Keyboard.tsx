import React, { useCallback, useEffect, useRef, useState } from 'react';

interface KeyboardProps {
  octave: number;
  onNoteOn: (note: number) => void;
  onNoteOff: (note: number) => void;
  onOctaveChange: (octave: number) => void;
  activeNotes: Set<number>;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const WHITE_INDICES = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const BLACK_INDICES = [1, 3, 6, 8, 10]; // C# D# F# G# A#
const BLACK_POSITIONS: Record<number, number> = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 };

// Computer keyboard mapping
const KEY_MAP: Record<string, number> = {
  'a': 0, 'w': 1, 's': 2, 'e': 3, 'd': 4,
  'f': 5, 't': 6, 'g': 7, 'y': 8, 'h': 9,
  'u': 10, 'j': 11, 'k': 12,
};

const Keyboard: React.FC<KeyboardProps> = ({
  octave, onNoteOn, onNoteOff, onOctaveChange, activeNotes,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());
  const touchNotes = useRef<Map<number, number>>(new Map()); // touchId -> note

  const baseNote = (octave + 2) * 12; // MIDI note for C at current octave

  // Computer keyboard handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      
      if (key === 'z') {
        onOctaveChange(Math.max(-2, octave - 1));
        return;
      }
      if (key === 'x') {
        onOctaveChange(Math.min(4, octave + 1));
        return;
      }

      if (KEY_MAP[key] !== undefined && !pressedKeys.has(key)) {
        const note = baseNote + KEY_MAP[key];
        setPressedKeys(prev => new Set(prev).add(key));
        onNoteOn(note);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (KEY_MAP[key] !== undefined) {
        const note = baseNote + KEY_MAP[key];
        setPressedKeys(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        onNoteOff(note);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [baseNote, octave, onNoteOn, onNoteOff, onOctaveChange, pressedKeys]);

  // Touch handling for piano keys
  const getNoteFromTouch = useCallback((x: number, y: number): number | null => {
    const container = containerRef.current;
    if (!container) return null;

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

  // Generate 2 octaves of keys
  const whiteKeys: { note: number; name: string }[] = [];
  const blackKeys: { note: number; name: string; position: number }[] = [];

  for (let oct = 0; oct < 2; oct++) {
    for (const idx of WHITE_INDICES) {
      const note = baseNote + oct * 12 + idx;
      whiteKeys.push({ note, name: NOTE_NAMES[idx] });
    }
    for (const idx of BLACK_INDICES) {
      const note = baseNote + oct * 12 + idx;
      const pos = BLACK_POSITIONS[idx] + oct * 7;
      blackKeys.push({ note, name: NOTE_NAMES[idx], position: pos });
    }
  }

  const whiteKeyWidth = 100 / whiteKeys.length;

  return (
    <div className="w-full select-none">
      {/* Octave controls */}
      <div className="flex items-center justify-between px-2 py-1">
        <button
          onClick={() => onOctaveChange(Math.max(-2, octave - 1))}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded bg-synth-panel text-synth-panel-foreground font-mono-synth text-sm border border-synth-panel-border active:bg-synth-panel-border"
        >
          OCT −
        </button>
        <span className="font-mono-synth text-xs text-foreground">
          C{octave + 3} – B{octave + 4}
        </span>
        <button
          onClick={() => onOctaveChange(Math.min(4, octave + 1))}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded bg-synth-panel text-synth-panel-foreground font-mono-synth text-sm border border-synth-panel-border active:bg-synth-panel-border"
        >
          OCT +
        </button>
      </div>

      {/* Piano keyboard */}
      <div
        ref={containerRef}
        className="relative w-full overflow-x-auto"
        style={{ height: 140, touchAction: 'none' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div className="relative h-full" style={{ minWidth: Math.max(whiteKeys.length * 44, 100) + '%' ? undefined : undefined, width: '100%' }}>
          {/* White keys */}
          {whiteKeys.map((key, i) => {
            const isActive = activeNotes.has(key.note);
            return (
              <div
                key={key.note}
                data-note={key.note}
                className={`absolute top-0 bottom-0 border-r border-border rounded-b-md flex items-end justify-center pb-2 cursor-pointer transition-colors duration-75
                  ${isActive ? 'bg-key-white-active led-glow-sm' : 'bg-key-white hover:brightness-95'}`}
                style={{
                  left: `${i * whiteKeyWidth}%`,
                  width: `${whiteKeyWidth}%`,
                }}
                onMouseDown={() => onNoteOn(key.note)}
                onMouseUp={() => onNoteOff(key.note)}
                onMouseLeave={() => { if (activeNotes.has(key.note)) onNoteOff(key.note); }}
              >
                <span className="text-[10px] font-mono-synth text-foreground/50 pointer-events-none">
                  {key.name}
                </span>
              </div>
            );
          })}

          {/* Black keys */}
          {blackKeys.map((key) => {
            const isActive = activeNotes.has(key.note);
            const leftPos = (key.position + 0.65) * whiteKeyWidth;
            return (
              <div
                key={key.note}
                data-note={key.note}
                className={`absolute top-0 rounded-b-md cursor-pointer z-10 transition-colors duration-75
                  ${isActive ? 'bg-key-black-active led-glow-sm' : 'bg-key-black hover:brightness-125'}`}
                style={{
                  left: `${leftPos}%`,
                  width: `${whiteKeyWidth * 0.65}%`,
                  height: '60%',
                }}
                onMouseDown={() => onNoteOn(key.note)}
                onMouseUp={() => onNoteOff(key.note)}
                onMouseLeave={() => { if (activeNotes.has(key.note)) onNoteOff(key.note); }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Keyboard;
