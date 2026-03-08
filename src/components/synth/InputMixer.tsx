import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight, Mic, AudioLines, Volume2, VolumeX, AlertTriangle } from 'lucide-react';
import { AudioInputEngine, InputState, InputSourceType } from '@/audio/AudioInputEngine';
import Knob from './Knob';

interface InputMixerProps {
  inputEngine: AudioInputEngine | null;
  initialized: boolean;
  ensureInit: () => Promise<void>;
}

const InputMixer: React.FC<InputMixerProps> = ({ inputEngine, initialized, ensureInit }) => {
  const [collapsed, setCollapsed] = useState(true);
  const [state, setState] = useState<InputState>({
    connected: false,
    sourceType: 'mic',
    gain: 1.0,
    monitoring: false,
    muted: false,
    level: 0,
    clipping: false,
    devices: [],
    selectedDeviceId: null,
    permissionDenied: false,
    noDevice: false,
    eqLow: 0,
    eqMid: 0,
    eqHigh: 0,
  });
  const [showMonitorWarning, setShowMonitorWarning] = useState(false);
  const [showDeviceDropdown, setShowDeviceDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!inputEngine) return;
    inputEngine.setOnStateChange(setState);
    setState(inputEngine.getState());
  }, [inputEngine]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDeviceDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleConnect = useCallback(async (type: InputSourceType) => {
    await ensureInit();
    if (!inputEngine) return;
    if (state.connected && state.sourceType === type) {
      inputEngine.disconnect();
    } else {
      await inputEngine.connect(type);
    }
  }, [inputEngine, state.connected, state.sourceType, ensureInit]);

  const handleMonitorToggle = useCallback(() => {
    if (!inputEngine) return;
    if (!state.monitoring) {
      setShowMonitorWarning(true);
      setTimeout(() => setShowMonitorWarning(false), 4000);
    }
    inputEngine.setMonitoring(!state.monitoring);
  }, [inputEngine, state.monitoring]);

  const handleMute = useCallback(() => {
    inputEngine?.setMuted(!state.muted);
  }, [inputEngine, state.muted]);

  const handleGain = useCallback((v: number) => {
    inputEngine?.setGain(v);
  }, [inputEngine]);

  const handleDeviceSelect = useCallback((deviceId: string) => {
    inputEngine?.selectDevice(deviceId);
    setShowDeviceDropdown(false);
  }, [inputEngine]);

  // Level meter color segments
  const levelPercent = Math.round(state.level * 100);
  const levelColor = state.clipping ? 'bg-led-red' : levelPercent > 70 ? 'bg-yellow-500' : 'bg-led-green';

  return (
    <div className="bg-synth-panel border-b border-synth-panel-border">
      {/* Header toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full min-h-[44px] px-3 py-2 flex items-center gap-2 text-left"
      >
        {collapsed ? <ChevronRight className="w-4 h-4 text-synth-panel-foreground" /> : <ChevronDown className="w-4 h-4 text-synth-panel-foreground" />}
        <span className="font-display text-[10px] text-led-amber tracking-widest">INPUT</span>
        {state.connected && (
          <>
            <div className={`w-2 h-2 rounded-full ${state.muted ? 'bg-led-red' : 'bg-led-green'} animate-led-pulse`} />
            {/* Compact level bar in header */}
            <div className="w-16 h-2 bg-synth-surface-dark rounded-full overflow-hidden">
              <div className={`h-full ${levelColor} transition-all duration-75`} style={{ width: `${levelPercent}%` }} />
            </div>
          </>
        )}
        {state.permissionDenied && <span className="text-[9px] font-mono-synth text-led-red">NO ACCESS</span>}
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-3">
          {/* Permission denied message */}
          {state.permissionDenied && (
            <div className="p-2 rounded border border-led-red/50 bg-led-red/10">
              <p className="text-[10px] font-mono-synth text-led-red">
                마이크 접근을 허용해 주세요. 브라우저 주소창 옆 자물쇠 아이콘을 클릭하세요.
              </p>
            </div>
          )}

          {state.noDevice && !state.permissionDenied && (
            <div className="p-2 rounded border border-led-amber/50 bg-led-amber/10">
              <p className="text-[10px] font-mono-synth text-led-amber">
                입력 장치를 찾을 수 없습니다
              </p>
            </div>
          )}

          {/* Monitor warning */}
          {showMonitorWarning && (
            <div className="p-2 rounded border border-led-amber/50 bg-led-amber/10 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-led-amber flex-shrink-0" />
              <p className="text-[10px] font-mono-synth text-led-amber">
                스피커 사용 시 하울링이 발생할 수 있습니다. 헤드폰 사용을 권장합니다.
              </p>
            </div>
          )}

          {/* Source selector */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1">
              <button
                onClick={() => handleConnect('mic')}
                className={`min-w-[44px] min-h-[44px] px-3 py-2 rounded font-display text-[10px] tracking-wider border transition-colors flex items-center gap-1.5
                  ${state.connected && state.sourceType === 'mic'
                    ? 'bg-led-amber/20 text-led-amber border-led-amber'
                    : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border hover:border-synth-panel-foreground/30'
                  }`}
              >
                <Mic className="w-3.5 h-3.5" />
                MIC
              </button>

              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => {
                    if (state.devices.length > 1) {
                      setShowDeviceDropdown(!showDeviceDropdown);
                    }
                    handleConnect('line-in');
                  }}
                  className={`min-w-[44px] min-h-[44px] px-3 py-2 rounded font-display text-[10px] tracking-wider border transition-colors flex items-center gap-1.5
                    ${state.connected && state.sourceType === 'line-in'
                      ? 'bg-led-amber/20 text-led-amber border-led-amber'
                      : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border hover:border-synth-panel-foreground/30'
                    }`}
                >
                  <AudioLines className="w-3.5 h-3.5" />
                  LINE IN
                </button>

                {showDeviceDropdown && state.devices.length > 1 && (
                  <div className="absolute top-full left-0 mt-1 z-50 min-w-[200px] bg-synth-surface-dark border border-synth-panel-border rounded shadow-lg">
                    {state.devices.map(d => (
                      <button
                        key={d.deviceId}
                        onClick={() => handleDeviceSelect(d.deviceId)}
                        className={`w-full text-left px-3 py-2 min-h-[44px] text-[10px] font-mono-synth transition-colors
                          ${state.selectedDeviceId === d.deviceId
                            ? 'text-led-amber bg-led-amber/10'
                            : 'text-synth-panel-foreground hover:bg-synth-panel-border/30'
                          }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Controls */}
            <Knob
              value={state.gain}
              min={0}
              max={2}
              step={0.01}
              label="IN GAIN"
              onChange={handleGain}
              size="sm"
              formatValue={(v) => `${Math.round(v * 100)}%`}
            />

            {/* Monitor */}
            <button
              onClick={handleMonitorToggle}
              className={`min-w-[44px] min-h-[44px] px-3 py-2 rounded font-display text-[10px] tracking-wider border transition-colors flex items-center gap-1.5
                ${state.monitoring
                  ? 'bg-led-amber/20 text-led-amber border-led-amber'
                  : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border hover:border-synth-panel-foreground/30'
                }`}
            >
              <Volume2 className="w-3.5 h-3.5" />
              MON
            </button>

            {/* Mute */}
            <button
              onClick={handleMute}
              className={`min-w-[44px] min-h-[44px] px-3 py-2 rounded font-display text-[10px] tracking-wider border transition-colors flex items-center gap-1.5
                ${state.muted
                  ? 'bg-led-red/30 text-led-red border-led-red'
                  : 'bg-synth-surface-dark text-synth-panel-foreground border-synth-panel-border hover:border-synth-panel-foreground/30'
                }`}
            >
              <VolumeX className="w-3.5 h-3.5" />
              MUTE
            </button>
          </div>

          {/* 3-Band EQ */}
          <div className="flex items-end gap-2 flex-wrap">
            <span className="text-[9px] font-display text-synth-panel-foreground/50 uppercase tracking-widest self-center">EQ</span>
            <Knob
              value={state.eqLow}
              min={-12}
              max={12}
              step={0.5}
              label="LOW"
              onChange={(v) => inputEngine?.setEQ('low', v)}
              size="sm"
              formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}dB`}
            />
            <Knob
              value={state.eqMid}
              min={-12}
              max={12}
              step={0.5}
              label="MID"
              onChange={(v) => inputEngine?.setEQ('mid', v)}
              size="sm"
              formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}dB`}
            />
            <Knob
              value={state.eqHigh}
              min={-12}
              max={12}
              step={0.5}
              label="HIGH"
              onChange={(v) => inputEngine?.setEQ('high', v)}
              size="sm"
              formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}dB`}
            />
            <button
              onClick={() => inputEngine?.resetEQ()}
              className="min-w-[44px] min-h-[34px] px-2 py-1 rounded font-display text-[9px] tracking-wider border border-synth-panel-border bg-synth-surface-dark text-synth-panel-foreground hover:border-synth-panel-foreground/30 transition-colors"
            >
              FLAT
            </button>
          </div>

          {/* Level meter */}
          {state.connected && (
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-mono-synth text-synth-panel-foreground/50 uppercase tracking-wider w-8">LVL</span>
              <div className="flex-1 h-4 bg-synth-surface-dark rounded overflow-hidden relative">
                <div
                  className={`h-full transition-all duration-75 ${levelColor}`}
                  style={{ width: `${levelPercent}%` }}
                />
                {/* Threshold markers */}
                <div className="absolute top-0 left-[70%] w-px h-full bg-synth-panel-foreground/20" />
                <div className="absolute top-0 left-[90%] w-px h-full bg-led-red/30" />
                {state.clipping && (
                  <div className="absolute inset-0 bg-led-red/20 animate-pulse" />
                )}
              </div>
              <span className={`text-[9px] font-mono-synth w-8 text-right ${state.clipping ? 'text-led-red' : 'text-synth-panel-foreground/50'}`}>
                {state.clipping ? 'CLIP' : `${levelPercent}%`}
              </span>
            </div>
          )}

          {/* Mobile tip */}
          <p className="text-[8px] font-mono-synth text-synth-panel-foreground/30 md:hidden">
            입력 기기 연결 후 LINE IN 선택하세요
          </p>
        </div>
      )}
    </div>
  );
};

export default InputMixer;
