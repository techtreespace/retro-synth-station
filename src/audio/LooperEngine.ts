// Loop Station Engine — 4 loop slots with recording, playback, overdub, and master recording

export type LoopSlotStatus = 'empty' | 'recording' | 'playing' | 'stopped' | 'overdubbing';

export interface LoopSlot {
  status: LoopSlotStatus;
  buffer: AudioBuffer | null;
  bars: 1 | 2 | 4 | 8;
  volume: number;
  waveformData: number[]; // normalized amplitude bars for display
}

export class LooperEngine {
  private ctx: AudioContext | null = null;
  private destination: AudioNode | null = null;
  private slots: LoopSlot[] = [];
  private slotSources: (AudioBufferSourceNode | null)[] = [null, null, null, null];
  private slotGains: (GainNode | null)[] = [null, null, null, null];
  private slotRecorders: (MediaRecorder | null)[] = [null, null, null, null];
  private slotRecordChunks: Blob[][] = [[], [], [], []];
  private slotStreamDests: (MediaStreamAudioDestinationNode | null)[] = [null, null, null, null];
  private slotRecordStartTime: number[] = [0, 0, 0, 0];
  private slotLoopTimers: (number | null)[] = [null, null, null, null];

  // Master recording
  private masterRecorder: MediaRecorder | null = null;
  private masterRecordChunks: Blob[] = [];
  private masterStreamDest: MediaStreamAudioDestinationNode | null = null;
  private masterRecording = false;
  private masterRecordStart = 0;

  // Metronome
  private metronomeEnabled = false;
  private metronomeGain: GainNode | null = null;

  // BPM
  private bpm = 120;
  private syncToBpm = true;

  // Callbacks
  private onSlotChange: ((slotIndex: number, slot: LoopSlot) => void) | null = null;
  private onMasterRecordingChange: ((recording: boolean, elapsed: number) => void) | null = null;
  private onCountIn: ((beat: number) => void) | null = null;

  constructor() {
    this.slots = Array.from({ length: 4 }, () => ({
      status: 'empty' as LoopSlotStatus,
      buffer: null,
      bars: 2 as 1 | 2 | 4 | 8,
      volume: 0.8,
      waveformData: [],
    }));
  }

  init(ctx: AudioContext, dest: AudioNode): void {
    this.ctx = ctx;
    this.destination = dest;

    // Create master stream destination for master recording
    this.masterStreamDest = ctx.createMediaStreamDestination();

    // Create metronome gain
    this.metronomeGain = ctx.createGain();
    this.metronomeGain.gain.value = 0.3;
    this.metronomeGain.connect(dest);
    this.metronomeGain.connect(this.masterStreamDest);

    // Create slot gains
    for (let i = 0; i < 4; i++) {
      const gain = ctx.createGain();
      gain.gain.value = this.slots[i].volume;
      gain.connect(dest);
      gain.connect(this.masterStreamDest);
      this.slotGains[i] = gain;
    }
  }

  setOnSlotChange(cb: (slotIndex: number, slot: LoopSlot) => void): void { this.onSlotChange = cb; }
  setOnMasterRecordingChange(cb: (recording: boolean, elapsed: number) => void): void { this.onMasterRecordingChange = cb; }
  setOnCountIn(cb: (beat: number) => void): void { this.onCountIn = cb; }

  setBpm(bpm: number): void { this.bpm = bpm; }
  getBpm(): number { return this.bpm; }
  setSyncToBpm(sync: boolean): void { this.syncToBpm = sync; }
  setMetronomeEnabled(enabled: boolean): void { this.metronomeEnabled = enabled; }
  isMetronomeEnabled(): boolean { return this.metronomeEnabled; }

  getSlot(index: number): LoopSlot { return { ...this.slots[index] }; }
  getSlots(): LoopSlot[] { return this.slots.map(s => ({ ...s })); }

  setSlotBars(index: number, bars: 1 | 2 | 4 | 8): void {
    this.slots[index].bars = bars;
    this.onSlotChange?.(index, { ...this.slots[index] });
  }

  setSlotVolume(index: number, volume: number): void {
    this.slots[index].volume = volume;
    if (this.slotGains[index]) {
      this.slotGains[index]!.gain.setTargetAtTime(volume, this.ctx!.currentTime, 0.01);
    }
    this.onSlotChange?.(index, { ...this.slots[index] });
  }

  private getBarDuration(): number {
    return (60 / this.bpm) * 4; // 4 beats per bar
  }

  private playMetronomeClick(time: number, isDownbeat: boolean): void {
    if (!this.ctx || !this.metronomeGain || !this.metronomeEnabled) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = isDownbeat ? 1000 : 800;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.5, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.connect(env);
    env.connect(this.metronomeGain);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  async startSlotRecording(index: number): Promise<void> {
    if (!this.ctx || !this.destination) return;

    const slot = this.slots[index];

    // If already has content, this is overdub
    const isOverdub = slot.buffer !== null;

    // Count-in: 4 clicks before recording starts
    const beatDuration = 60 / this.bpm;
    const now = this.ctx.currentTime;

    for (let i = 0; i < 4; i++) {
      this.playMetronomeClick(now + i * beatDuration, i === 0);
      setTimeout(() => {
        this.onCountIn?.(i + 1);
      }, i * beatDuration * 1000);
    }

    // Start actual recording after count-in
    const countInDuration = 4 * beatDuration;
    const recordDuration = this.getBarDuration() * slot.bars;

    await new Promise(resolve => setTimeout(resolve, countInDuration * 1000));

    if (!this.ctx) return;

    // Create a stream destination to capture audio
    const streamDest = this.ctx.createMediaStreamDestination();
    this.slotStreamDests[index] = streamDest;

    // Connect destination output to the stream for capture
    // We need to capture via a separate analyser/gain node connected to destination
    // Instead, use createMediaStreamDestination and route main output through it
    // For simplicity: capture from a dedicated gain node that mirrors the main output
    const captureGain = this.ctx.createGain();
    captureGain.gain.value = 1;
    captureGain.connect(streamDest);

    // Connect the master gain output to capture
    // Since we can't tap into existing connections easily,
    // we'll use the approach of recording via the context destination
    const masterStreamDest = this.ctx.createMediaStreamDestination();
    
    // We need to tap the audio. Connect all slot gains + capture what's playing
    for (let i = 0; i < 4; i++) {
      if (this.slotGains[i] && i !== index) {
        this.slotGains[i]!.connect(masterStreamDest);
      }
    }

    // Actually, for slot recording we want to capture the synth output.
    // The simplest approach: record from the context destination stream.
    // But that requires user permission. Instead, let's record timing and rebuild.
    
    // Simpler approach: Just record raw audio via OfflineAudioContext won't work either.
    // Let's use MediaRecorder on context.destination if available, or the streamDest approach.

    // Most practical: use the existing audio output via createMediaStreamDestination
    // We already have masterStreamDest. Let's record from that for the slot.
    
    const recorder = new MediaRecorder(this.masterStreamDest!.stream, { mimeType: this.getSupportedMimeType() });
    this.slotRecordChunks[index] = [];
    
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.slotRecordChunks[index].push(e.data);
    };

    recorder.onstop = async () => {
      const blob = new Blob(this.slotRecordChunks[index], { type: recorder.mimeType });
      const arrayBuffer = await blob.arrayBuffer();
      try {
        const newBuffer = await this.ctx!.decodeAudioData(arrayBuffer);
        
        if (isOverdub && slot.buffer) {
          // Mix the existing buffer with the new recording
          const mixed = this.mixBuffers(slot.buffer, newBuffer);
          this.slots[index].buffer = mixed;
        } else {
          this.slots[index].buffer = newBuffer;
        }
        
        this.slots[index].waveformData = this.extractWaveform(this.slots[index].buffer!);
        this.slots[index].status = 'stopped';
        this.onSlotChange?.(index, { ...this.slots[index] });
      } catch (err) {
        console.error('Failed to decode recorded audio:', err);
        this.slots[index].status = slot.buffer ? 'stopped' : 'empty';
        this.onSlotChange?.(index, { ...this.slots[index] });
      }
    };

    this.slotRecorders[index] = recorder;
    this.slots[index].status = isOverdub ? 'overdubbing' : 'recording';
    this.onSlotChange?.(index, { ...this.slots[index] });
    
    recorder.start();
    this.slotRecordStartTime[index] = this.ctx.currentTime;

    // Auto-stop after loop length
    setTimeout(() => {
      this.stopSlotRecording(index);
    }, recordDuration * 1000);
  }

  stopSlotRecording(index: number): void {
    const recorder = this.slotRecorders[index];
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
    }
    this.slotRecorders[index] = null;
  }

  startSlotPlayback(index: number): void {
    if (!this.ctx || !this.slots[index].buffer || !this.slotGains[index]) return;

    this.stopSlotPlayback(index);

    const playLoop = () => {
      if (!this.ctx || !this.slots[index].buffer || this.slots[index].status !== 'playing') return;
      
      const source = this.ctx.createBufferSource();
      source.buffer = this.slots[index].buffer;
      source.connect(this.slotGains[index]!);
      source.start();
      this.slotSources[index] = source;

      const duration = source.buffer!.duration * 1000;
      this.slotLoopTimers[index] = window.setTimeout(() => {
        playLoop();
      }, duration);

      source.onended = () => {
        // cleanup handled by timer
      };
    };

    this.slots[index].status = 'playing';
    this.onSlotChange?.(index, { ...this.slots[index] });
    playLoop();
  }

  stopSlotPlayback(index: number): void {
    if (this.slotLoopTimers[index] !== null) {
      clearTimeout(this.slotLoopTimers[index]!);
      this.slotLoopTimers[index] = null;
    }
    if (this.slotSources[index]) {
      try { this.slotSources[index]!.stop(); } catch {}
      this.slotSources[index] = null;
    }
    if (this.slots[index].status === 'playing') {
      this.slots[index].status = 'stopped';
      this.onSlotChange?.(index, { ...this.slots[index] });
    }
  }

  toggleSlotPlayback(index: number): void {
    if (this.slots[index].status === 'playing') {
      this.stopSlotPlayback(index);
    } else if (this.slots[index].buffer) {
      this.startSlotPlayback(index);
    }
  }

  clearSlot(index: number): void {
    this.stopSlotPlayback(index);
    this.stopSlotRecording(index);
    this.slots[index] = {
      status: 'empty',
      buffer: null,
      bars: this.slots[index].bars,
      volume: this.slots[index].volume,
      waveformData: [],
    };
    this.onSlotChange?.(index, { ...this.slots[index] });
  }

  stopAllSlots(): void {
    for (let i = 0; i < 4; i++) {
      this.stopSlotPlayback(i);
    }
  }

  resumeActiveSlots(): void {
    for (let i = 0; i < 4; i++) {
      if (this.slots[i].buffer && this.slots[i].status === 'stopped') {
        // Only resume slots that were previously playing — we track this externally
      }
    }
  }

  // Master Recording
  startMasterRecording(): void {
    if (!this.ctx || !this.masterStreamDest || this.masterRecording) return;

    // Also need to connect synth engine's output. Since we can't directly,
    // we'll capture from context.destination via createMediaStreamDestination
    // which we already set up in init()

    const recorder = new MediaRecorder(this.masterStreamDest.stream, { 
      mimeType: this.getSupportedMimeType() 
    });
    this.masterRecordChunks = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.masterRecordChunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(this.masterRecordChunks, { type: recorder.mimeType });
      this.downloadBlob(blob, `retrosynth_${Date.now()}.wav`);
      this.masterRecording = false;
      this.onMasterRecordingChange?.(false, 0);
    };

    this.masterRecorder = recorder;
    this.masterRecording = true;
    this.masterRecordStart = Date.now();
    recorder.start(250); // collect data every 250ms

    this.onMasterRecordingChange?.(true, 0);
  }

  stopMasterRecording(): void {
    if (this.masterRecorder && this.masterRecorder.state === 'recording') {
      this.masterRecorder.stop();
    }
    this.masterRecorder = null;
  }

  toggleMasterRecording(): void {
    if (this.masterRecording) {
      this.stopMasterRecording();
    } else {
      this.startMasterRecording();
    }
  }

  isMasterRecording(): boolean { return this.masterRecording; }
  getMasterRecordElapsed(): number {
    if (!this.masterRecording) return 0;
    return (Date.now() - this.masterRecordStart) / 1000;
  }

  getAudioContext(): AudioContext | null { return this.ctx; }
  getMasterStreamDest(): MediaStreamAudioDestinationNode | null { return this.masterStreamDest; }

  private getSupportedMimeType(): string {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return 'audio/webm';
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private mixBuffers(buf1: AudioBuffer, buf2: AudioBuffer): AudioBuffer {
    if (!this.ctx) return buf1;
    const length = Math.max(buf1.length, buf2.length);
    const channels = Math.max(buf1.numberOfChannels, buf2.numberOfChannels);
    const mixed = this.ctx.createBuffer(channels, length, buf1.sampleRate);

    for (let ch = 0; ch < channels; ch++) {
      const output = mixed.getChannelData(ch);
      const data1 = ch < buf1.numberOfChannels ? buf1.getChannelData(ch) : null;
      const data2 = ch < buf2.numberOfChannels ? buf2.getChannelData(ch) : null;
      for (let i = 0; i < length; i++) {
        const s1 = data1 && i < data1.length ? data1[i] : 0;
        const s2 = data2 && i < data2.length ? data2[i] : 0;
        output[i] = Math.max(-1, Math.min(1, s1 + s2));
      }
    }
    return mixed;
  }

  private extractWaveform(buffer: AudioBuffer, bars = 32): number[] {
    const data = buffer.getChannelData(0);
    const blockSize = Math.floor(data.length / bars);
    const waveform: number[] = [];
    for (let i = 0; i < bars; i++) {
      let sum = 0;
      const start = i * blockSize;
      for (let j = start; j < start + blockSize && j < data.length; j++) {
        sum += Math.abs(data[j]);
      }
      waveform.push(sum / blockSize);
    }
    // Normalize
    const max = Math.max(...waveform, 0.001);
    return waveform.map(v => v / max);
  }

  destroy(): void {
    this.stopAllSlots();
    this.stopMasterRecording();
    for (let i = 0; i < 4; i++) {
      this.stopSlotRecording(i);
      this.slotGains[i]?.disconnect();
    }
    this.metronomeGain?.disconnect();
    this.masterStreamDest?.disconnect();
  }
}
