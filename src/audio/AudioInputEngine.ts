// External Audio Input Engine — mic/line-in with gain, monitor, mute, level metering

export interface InputDevice {
  deviceId: string;
  label: string;
}

export type InputSourceType = 'mic' | 'line-in';

export interface InputState {
  connected: boolean;
  sourceType: InputSourceType;
  gain: number;        // 0-2 (0~200%)
  monitoring: boolean;
  muted: boolean;
  level: number;       // 0-1 RMS level
  clipping: boolean;
  devices: InputDevice[];
  selectedDeviceId: string | null;
  permissionDenied: boolean;
  noDevice: boolean;
  eqLow: number;      // -12 to +12 dB
  eqMid: number;
  eqHigh: number;
}

type StateCallback = (state: InputState) => void;

export class AudioInputEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private masterStreamDest: MediaStreamAudioDestinationNode | null = null;

  // Audio nodes
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private highpassFilter: BiquadFilterNode | null = null;
  private lowEQ: BiquadFilterNode | null = null;
  private midEQ: BiquadFilterNode | null = null;
  private highEQ: BiquadFilterNode | null = null;
  private inputGainNode: GainNode | null = null;
  private muteGainNode: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private monitorGainNode: GainNode | null = null;

  // State
  private state: InputState = {
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
  };

  private onStateChange: StateCallback | null = null;
  private levelAnimFrame: number | null = null;
  private analyserData: Float32Array<ArrayBuffer> | null = null;

  init(ctx: AudioContext, masterGain: GainNode, masterStreamDest?: MediaStreamAudioDestinationNode | null): void {
    this.ctx = ctx;
    this.masterGain = masterGain;
    this.masterStreamDest = masterStreamDest || null;

    // Listen for device changes
    navigator.mediaDevices?.addEventListener('devicechange', this.refreshDevices);
    this.refreshDevices();
  }

  setOnStateChange(cb: StateCallback): void {
    this.onStateChange = cb;
  }

  private emit(): void {
    this.onStateChange?.({ ...this.state });
  }

  private refreshDevices = async (): Promise<void> => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices
        .filter(d => d.kind === 'audioinput')
        .map(d => ({ deviceId: d.deviceId, label: d.label || `Input ${d.deviceId.slice(0, 6)}` }));
      this.state.devices = audioInputs;
      this.state.noDevice = audioInputs.length === 0;
      this.emit();
    } catch {
      this.state.noDevice = true;
      this.emit();
    }
  };

  async connect(sourceType: InputSourceType, deviceId?: string | null): Promise<void> {
    if (!this.ctx) return;

    // Disconnect existing
    this.disconnect();

    const selectedId = deviceId || (sourceType === 'line-in' ? this.state.devices[this.state.devices.length - 1]?.deviceId : undefined);

    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: selectedId ? { exact: selectedId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.state.permissionDenied = false;
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        this.state.permissionDenied = true;
      } else {
        this.state.noDevice = true;
      }
      this.emit();
      return;
    }

    // Build audio graph: source → highpass → inputGain → muteGain → masterGain
    this.sourceNode = this.ctx.createMediaStreamSource(this.stream);

    this.highpassFilter = this.ctx.createBiquadFilter();
    this.highpassFilter.type = 'highpass';
    this.highpassFilter.frequency.value = 80;

    this.inputGainNode = this.ctx.createGain();
    this.inputGainNode.gain.value = this.state.gain;

    this.muteGainNode = this.ctx.createGain();
    this.muteGainNode.gain.value = this.state.muted ? 0 : 1;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyserData = new Float32Array(this.analyser.fftSize);

    // Monitor gain (to destination directly, separate from master)
    this.monitorGainNode = this.ctx.createGain();
    this.monitorGainNode.gain.value = 0; // off by default

    // Chain
    this.sourceNode.connect(this.highpassFilter);
    this.highpassFilter.connect(this.inputGainNode);
    this.inputGainNode.connect(this.muteGainNode);

    // Analyser taps after inputGain (before mute) so level shows even when muted
    this.inputGainNode.connect(this.analyser);

    // Route to master bus (for recording/looper)
    this.muteGainNode.connect(this.masterGain!);

    // Route to master stream dest too (for master recording)
    if (this.masterStreamDest) {
      this.muteGainNode.connect(this.masterStreamDest);
    }

    // Monitor path (direct to speakers)
    this.muteGainNode.connect(this.monitorGainNode);
    this.monitorGainNode.connect(this.ctx.destination);

    if (this.state.monitoring) {
      this.monitorGainNode.gain.value = 1;
    }

    this.state.connected = true;
    this.state.sourceType = sourceType;
    this.state.selectedDeviceId = selectedId || null;
    this.emit();

    // Start level metering
    this.startLevelMeter();

    // Refresh device labels (after permission granted)
    this.refreshDevices();
  }

  disconnect(): void {
    this.stopLevelMeter();

    try {
      this.monitorGainNode?.disconnect();
      this.muteGainNode?.disconnect();
      this.inputGainNode?.disconnect();
      this.analyser?.disconnect();
      this.highpassFilter?.disconnect();
      this.sourceNode?.disconnect();
    } catch {}

    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.sourceNode = null;
    this.highpassFilter = null;
    this.inputGainNode = null;
    this.muteGainNode = null;
    this.analyser = null;
    this.monitorGainNode = null;

    this.state.connected = false;
    this.state.level = 0;
    this.state.clipping = false;
    this.emit();
  }

  setGain(value: number): void {
    this.state.gain = Math.max(0, Math.min(2, value));
    if (this.inputGainNode) {
      this.inputGainNode.gain.value = this.state.gain;
    }
    this.emit();
  }

  setMonitoring(enabled: boolean): void {
    this.state.monitoring = enabled;
    if (this.monitorGainNode) {
      this.monitorGainNode.gain.value = enabled ? 1 : 0;
    }
    this.emit();
  }

  setMuted(muted: boolean): void {
    this.state.muted = muted;
    if (this.muteGainNode) {
      this.muteGainNode.gain.value = muted ? 0 : 1;
    }
    this.emit();
  }

  selectDevice(deviceId: string): void {
    if (this.state.connected) {
      this.connect(this.state.sourceType, deviceId);
    } else {
      this.state.selectedDeviceId = deviceId;
      this.emit();
    }
  }

  getState(): InputState {
    return { ...this.state };
  }

  private startLevelMeter(): void {
    const tick = () => {
      if (!this.analyser || !this.analyserData) return;
      this.analyser.getFloatTimeDomainData(this.analyserData);

      // RMS level
      let sum = 0;
      for (let i = 0; i < this.analyserData.length; i++) {
        sum += this.analyserData[i] * this.analyserData[i];
      }
      const rms = Math.sqrt(sum / this.analyserData.length);
      const level = Math.min(1, rms * 3); // scale up for visibility

      this.state.level = level;
      this.state.clipping = level >= 0.95;
      this.emit();

      this.levelAnimFrame = requestAnimationFrame(tick);
    };
    this.levelAnimFrame = requestAnimationFrame(tick);
  }

  private stopLevelMeter(): void {
    if (this.levelAnimFrame !== null) {
      cancelAnimationFrame(this.levelAnimFrame);
      this.levelAnimFrame = null;
    }
  }

  destroy(): void {
    this.disconnect();
    navigator.mediaDevices?.removeEventListener('devicechange', this.refreshDevices);
  }
}
