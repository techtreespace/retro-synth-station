import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Circle, Pause, Square, Play, Download, Settings, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type RecState = 'idle' | 'recording' | 'paused' | 'stopped' | 'previewing';
type ExportFormat = 'wav' | 'webm' | 'mp4';

// State → button enabled/disabled map (EXACT spec)
const BUTTON_STATES: Record<RecState, { rec: boolean; pause: boolean; stop: boolean; preview: boolean; save: boolean; del: boolean }> = {
  idle:       { rec: true,  pause: false, stop: false, preview: false, save: false, del: false },
  recording:  { rec: false, pause: true,  stop: true,  preview: false, save: false, del: false },
  paused:     { rec: true,  pause: false, stop: true,  preview: true,  save: false, del: false },
  stopped:    { rec: true,  pause: false, stop: false, preview: true,  save: true,  del: true  },
  previewing: { rec: false, pause: false, stop: true,  preview: false, save: true,  del: false },
};

interface RecTransportProps {
  looperRef: React.RefObject<{
    startMasterRecording: () => void;
    pauseMasterRecording: () => void;
    resumeMasterRecording: () => void;
    stopMasterRecording: (format: ExportFormat) => void;
    previewMasterRecording: (onEnd: () => void) => Promise<void>;
    stopMasterPreview: () => void;
    discardMasterRecording: () => void;
    getMasterRecordElapsed: () => number;
    getMasterRecordSize: () => number;
  } | null>;
  sequencerRef: React.RefObject<{
    pauseSequencer: () => { step: number; contextTime: number; bpm: number } | null;
    resumeFromPosition: (pos: { step: number; contextTime: number; bpm: number }) => void;
  } | null>;
  inputRef: React.RefObject<{
    setMonitoring: (on: boolean) => void;
  } | null>;
  ensureInit: () => Promise<void>;
}

const RecTransport: React.FC<RecTransportProps> = ({
  looperRef,
  sequencerRef,
  inputRef,
  ensureInit,
}) => {
  const [recState, setRecState] = useState<RecState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [previewPos, setPreviewPos] = useState(0);
  const [blobSize, setBlobSize] = useState(0);
  const [exportFormat, setExportFormat] = useState<ExportFormat>(() => {
    return (localStorage.getItem('retrosynth-export-format') as ExportFormat) || 'wav';
  });
  const [showFormatPicker, setShowFormatPicker] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const timerRef = useRef<number | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const seqPauseRef = useRef<{ step: number; contextTime: number; bpm: number } | null>(null);
  const formatPickerRef = useRef<HTMLDivElement>(null);

  // Persist format
  useEffect(() => {
    localStorage.setItem('retrosynth-export-format', exportFormat);
  }, [exportFormat]);

  // Close format picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (formatPickerRef.current && !formatPickerRef.current.contains(e.target as Node)) {
        setShowFormatPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (previewTimerRef.current) clearInterval(previewTimerRef.current);
    };
  }, []);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setElapsed(looperRef.current?.getMasterRecordElapsed() ?? 0);
    }, 200);
  }, [looperRef]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const formatTime = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  // === HANDLERS ===

  const handleRec = useCallback(async () => {
    await ensureInit();
    if (!looperRef.current) return;

    // In STOPPED or PAUSED state with existing recording, immediately discard (no modal)
    if (recState === 'stopped' || recState === 'paused') {
      looperRef.current.discardMasterRecording();
    }

    looperRef.current.startMasterRecording();
    setRecState('recording');
    setElapsed(0);
    setPreviewPos(0);
    setBlobSize(0);
    startTimer();
  }, [ensureInit, looperRef, recState, startTimer]);

  const handlePause = useCallback(() => {
    if (!looperRef.current) return;
    looperRef.current.pauseMasterRecording();
    stopTimer();
    const pos = sequencerRef.current?.pauseSequencer() ?? null;
    seqPauseRef.current = pos;
    inputRef.current?.setMonitoring(false);
    setRecState('paused');
  }, [looperRef, sequencerRef, inputRef, stopTimer]);

  const handleStop = useCallback(() => {
    if (!looperRef.current) return;

    if (recState === 'previewing') {
      looperRef.current.stopMasterPreview();
      if (previewTimerRef.current) {
        clearInterval(previewTimerRef.current);
        previewTimerRef.current = null;
      }
    } else {
      looperRef.current.pauseMasterRecording();
    }

    stopTimer();
    setBlobSize(looperRef.current.getMasterRecordSize?.() ?? 0);
    setRecState('stopped');
  }, [looperRef, recState, stopTimer]);

  const handlePreview = useCallback(async () => {
    if (!looperRef.current) return;

    setRecState('previewing');
    setPreviewPos(0);

    // Start preview position timer
    if (previewTimerRef.current) clearInterval(previewTimerRef.current);
    const startTime = Date.now();
    previewTimerRef.current = window.setInterval(() => {
      setPreviewPos((Date.now() - startTime) / 1000);
    }, 100);

    await looperRef.current.previewMasterRecording(() => {
      if (previewTimerRef.current) {
        clearInterval(previewTimerRef.current);
        previewTimerRef.current = null;
      }
      setRecState('stopped');
    });
  }, [looperRef]);

  const handleSave = useCallback(() => {
    if (!looperRef.current) return;
    looperRef.current.stopMasterRecording(exportFormat);
    stopTimer();
    if (previewTimerRef.current) {
      clearInterval(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    setRecState('idle');
    setElapsed(0);
    setPreviewPos(0);
    setBlobSize(0);
    seqPauseRef.current = null;
  }, [looperRef, exportFormat, stopTimer]);

  const handleDelete = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  const confirmDelete = useCallback(() => {
    if (!looperRef.current) return;
    looperRef.current.discardMasterRecording();
    setShowDeleteConfirm(false);
    setRecState('idle');
    setElapsed(0);
    setPreviewPos(0);
    setBlobSize(0);
    seqPauseRef.current = null;
  }, [looperRef]);

  // Current button states
  const btnStates = BUTTON_STATES[recState];

  // Time row content per state
  const renderTimeRow = () => {
    switch (recState) {
      case 'idle':
        return <span className="text-synth-panel-foreground/50">00:00</span>;
      case 'recording':
        return <span className="text-led-red">● {formatTime(elapsed)}</span>;
      case 'paused':
        return <span className="text-led-amber">⏸ {formatTime(elapsed)}</span>;
      case 'stopped':
        return <span className="text-synth-panel-foreground/60">■ {formatTime(elapsed)} 완료  {formatSize(blobSize)}</span>;
      case 'previewing':
        return <span className="text-led-amber">▶ {formatTime(previewPos)} / {formatTime(elapsed)}</span>;
    }
  };

  // Button style helper — uses design tokens only
  const getBtnStyle = (enabled: boolean, variant?: 'rec' | 'del' | 'active-rec' | 'active-preview') => {
    const base = "w-[36px] h-[32px] flex flex-col items-center justify-center gap-[1px] p-0 flex-shrink-0 rounded border transition-opacity duration-150";

    if (!enabled) {
      return `${base} opacity-25 cursor-not-allowed pointer-events-none border-synth-panel-border bg-synth-surface-dark text-synth-panel-foreground`;
    }

    switch (variant) {
      case 'rec':
        return `${base} opacity-100 cursor-pointer border-led-red/60 bg-synth-surface-dark text-led-red hover:bg-led-red/10`;
      case 'active-rec':
        return `${base} opacity-100 cursor-pointer border-led-red bg-led-red/20 text-led-red animate-pulse`;
      case 'del':
        return `${base} opacity-100 cursor-pointer border-led-red bg-synth-surface-dark text-led-red hover:bg-led-red/10`;
      case 'active-preview':
        return `${base} opacity-100 cursor-pointer border-led-green bg-led-green/20 text-led-green animate-pulse`;
      default:
        return `${base} opacity-100 cursor-pointer border-led-amber/60 bg-synth-surface-dark text-led-amber hover:bg-led-amber/10`;
    }
  };

  return (
    <>
      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">녹음 삭제</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              녹음을 삭제하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border">취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-led-red text-white hover:bg-led-red/80"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Transport container */}
      <div className="flex flex-col items-end gap-[3px] flex-shrink-0">
        {/* Button row - all 7 buttons always rendered */}
        <div className="flex flex-row gap-[2px] items-center">
          {/* 1. Format selector (⚙) - always enabled, width 52px */}
          <div className="relative" ref={formatPickerRef}>
            <button
              onClick={() => setShowFormatPicker(!showFormatPicker)}
              className="w-[44px] h-[32px] flex flex-col items-center justify-center gap-[1px] p-0 flex-shrink-0 rounded border border-synth-panel-border bg-synth-surface-dark text-synth-panel-foreground hover:border-led-amber/60 hover:text-led-amber transition-colors cursor-pointer"
            >
              <Settings className="w-3 h-3" />
              <span className="text-[7px] tracking-wider leading-none">{exportFormat.toUpperCase()}</span>
            </button>

            {showFormatPicker && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-synth-surface-dark border border-synth-panel-border rounded shadow-lg min-w-[140px]">
                {([
                  { value: 'wav' as ExportFormat, label: 'WAV', desc: 'recommended' },
                  { value: 'webm' as ExportFormat, label: 'WEBM', desc: 'smaller file' },
                  { value: 'mp4' as ExportFormat, label: 'MP4', desc: 'iOS Safari' },
                ]).map(f => (
                  <button
                    key={f.value}
                    onClick={() => { setExportFormat(f.value); setShowFormatPicker(false); }}
                    className={`w-full text-left px-3 py-2 min-h-[36px] flex items-center gap-2 transition-colors ${
                      exportFormat === f.value
                        ? 'text-led-amber bg-led-amber/10'
                        : 'text-synth-panel-foreground hover:bg-synth-panel-border/30'
                    }`}
                  >
                    <span className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${
                      exportFormat === f.value ? 'border-led-amber bg-led-amber' : 'border-synth-panel-foreground/40'
                    }`} />
                    <div>
                      <span className="text-[10px] font-display tracking-wider">{f.label}</span>
                      <span className="text-[8px] font-mono-synth ml-1 opacity-50">{f.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 2. REC (●) */}
          <button
            onClick={btnStates.rec ? handleRec : undefined}
            className={getBtnStyle(btnStates.rec, recState === 'recording' ? 'active-rec' : 'rec')}
          >
            <Circle className="w-3 h-3" fill={recState === 'recording' ? 'currentColor' : 'none'} />
            <span className="text-[7px] tracking-wider leading-none">REC</span>
          </button>

          {/* 3. PAUSE (⏸) */}
          <button
            onClick={btnStates.pause ? handlePause : undefined}
            className={getBtnStyle(btnStates.pause)}
          >
            <Pause className="w-3 h-3" />
            <span className="text-[7px] tracking-wider leading-none">PAUSE</span>
          </button>

          {/* 4. STOP (■) */}
          <button
            onClick={btnStates.stop ? handleStop : undefined}
            className={getBtnStyle(btnStates.stop)}
          >
            <Square className="w-3 h-3" />
            <span className="text-[7px] tracking-wider leading-none">STOP</span>
          </button>

          {/* 5. PREVIEW (▶) */}
          <button
            onClick={btnStates.preview ? handlePreview : undefined}
            className={getBtnStyle(btnStates.preview, recState === 'previewing' ? 'active-preview' : undefined)}
          >
            <Play className="w-3 h-3" />
            <span className="text-[7px] tracking-wider leading-none">PRE</span>
          </button>

          {/* 6. SAVE (↓) */}
          <button
            onClick={btnStates.save ? handleSave : undefined}
            className={getBtnStyle(btnStates.save)}
          >
            <Download className="w-3 h-3" />
            <span className="text-[7px] tracking-wider leading-none">SAVE</span>
          </button>

          {/* 7. DEL (🗑) */}
          <button
            onClick={btnStates.del ? handleDelete : undefined}
            className={getBtnStyle(btnStates.del, 'del')}
          >
            <Trash2 className="w-3 h-3" />
            <span className="text-[7px] tracking-wider leading-none">DEL</span>
          </button>
        </div>

        {/* Time row - always rendered, fixed height */}
        <div className="h-[14px] w-full flex items-center justify-end font-mono text-[10px] tracking-wide whitespace-nowrap">
          {renderTimeRow()}
        </div>
      </div>
    </>
  );
};

export default RecTransport;
