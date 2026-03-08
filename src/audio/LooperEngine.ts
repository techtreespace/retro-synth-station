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
  private synthMasterGain: GainNode | null = null;
  private slots: LoopSlot[] = [];
  private slotSources: (AudioBufferSourceNode | null)[] = [null, null, null, null];
  private slotGains: (GainNode | null)[] = [null, null, null, null];
  private slotRecordProcessors: (ScriptProcessorNode | null)[] = [null, null, null, null];
  private slotRecordBuffers: Float32Array[][] = [[], [], [], []];
  private slotLoopTimers: (number | null)[] = [null, null, null, null];
  private slotRecordTimers: (number | null)[] = [null, null, null, null];

  // Master recording
  private masterRecorder: MediaRecorder | null = null;
  private masterRecordChunks: Blob[] = [];
  private masterStreamDest: MediaStreamAudioDestinationNode | null = null;
  private masterRecording = false;
  private masterRecordStart = 0;

  // (captureStreamDest removed — slot recording uses ScriptProcessorNode for raw PCM)

  // Metronome
  private metronomeEnabled = false;
  private metronomeGain: GainNode | null = null;

  // BPM
  private bpm = 120;
  private syncToBpm = true;
  private sequencerStartTime = 0; // AudioContext time when sequencer started

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

  init(ctx: AudioContext, dest: AudioNode, synthMasterGain?: GainNode | null): void {
    this.ctx = ctx;
    this.destination = dest;
    this.synthMasterGain = synthMasterGain || null;

    // Slot recording now uses ScriptProcessorNode directly on synthMasterGain

    // Create master stream destination for master recording
    this.masterStreamDest = ctx.createMediaStreamDestination();
    if (this.synthMasterGain) {
      this.synthMasterGain.connect(this.masterStreamDest);
    }

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
  setSequencerStartTime(time: number): void { this.sequencerStartTime = time; }

  private getNextBarTime(): number {
    if (!this.ctx) return 0;
    const barDuration = this.getBarDuration();
    const elapsed = this.ctx.currentTime - this.sequencerStartTime;
    const barsElapsed = Math.floor(elapsed / barDuration);
    return this.sequencerStartTime + (barsElapsed + 1) * barDuration;
  }

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
    if (!this.ctx || !this.synthMasterGain) return;

    const slot = this.slots[index];
    const isOverdub = slot.buffer !== null;

    // Schedule recording to start at the next bar boundary
    const beatDuration = 60 / this.bpm;
    const nextBar = this.syncToBpm ? this.getNextBarTime() : this.ctx.currentTime + 4 * beatDuration;
    const now = this.ctx.currentTime;
    const waitUntilBar = nextBar - now;

    // Count-in clicks leading up to next bar
    const beatsUntilBar = Math.round(waitUntilBar / beatDuration);
    const countInBeats = Math.min(beatsUntilBar, 4);
    const countInStart = nextBar - countInBeats * beatDuration;

    for (let i = 0; i < countInBeats; i++) {
      const clickTime = countInStart + i * beatDuration;
      if (clickTime >= now) {
        this.playMetronomeClick(clickTime, i === 0);
        setTimeout(() => {
          this.onCountIn?.(i + 1);
        }, (clickTime - now) * 1000);
      }
    }

    const recordDuration = this.getBarDuration() * slot.bars;

    // Wait until the next bar boundary
    await new Promise(resolve => setTimeout(resolve, waitUntilBar * 1000));

    if (!this.ctx) return;

    // Use ScriptProcessorNode to capture raw PCM — SILENT tap only (no pass-through)
    const bufferSize = 4096;
    const processor = this.ctx.createScriptProcessor(bufferSize, 2, 2);
    this.slotRecordBuffers[index] = [];

    processor.onaudioprocess = (e) => {
      // Capture left channel only
      const inputL = e.inputBuffer.getChannelData(0);
      this.slotRecordBuffers[index].push(new Float32Array(inputL));
      // Output silence — do NOT pass through to avoid double monitoring
      for (let ch = 0; ch < e.outputBuffer.numberOfChannels; ch++) {
        e.outputBuffer.getChannelData(ch).fill(0);
      }
    };

    // Connect: synthMasterGain → processor → destination
    // Processor outputs silence so no double audio, but must connect to destination
    // for ScriptProcessorNode to actually fire onaudioprocess
    this.synthMasterGain.connect(processor);
    processor.connect(this.ctx.destination);
    this.slotRecordProcessors[index] = processor;

    this.slots[index].status = isOverdub ? 'overdubbing' : 'recording';
    this.onSlotChange?.(index, { ...this.slots[index] });

    // Auto-stop after loop length
    this.slotRecordTimers[index] = window.setTimeout(() => {
      this.stopSlotRecording(index);
    }, recordDuration * 1000);
  }

  stopSlotRecording(index: number): void {
    if (!this.ctx) return;

    // Clear timer
    if (this.slotRecordTimers[index] !== null) {
      clearTimeout(this.slotRecordTimers[index]!);
      this.slotRecordTimers[index] = null;
    }

    // Disconnect processor
    const processor = this.slotRecordProcessors[index];
    if (processor) {
      try { processor.disconnect(); } catch {}
      if (this.synthMasterGain) {
        try { this.synthMasterGain.disconnect(processor); } catch {}
      }
      this.slotRecordProcessors[index] = null;
    }

    // Build AudioBuffer from captured PCM chunks
    const chunks = this.slotRecordBuffers[index];
    if (chunks.length === 0) {
      this.slots[index].status = this.slots[index].buffer ? 'stopped' : 'empty';
      this.onSlotChange?.(index, { ...this.slots[index] });
      return;
    }

    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const newBuffer = this.ctx.createBuffer(1, totalLength, this.ctx.sampleRate);
    newBuffer.getChannelData(0).set(merged);

    const slot = this.slots[index];
    if (slot.buffer) {
      // Overdub: mix existing + new
      this.slots[index].buffer = this.mixBuffers(slot.buffer, newBuffer);
    } else {
      this.slots[index].buffer = newBuffer;
    }

    this.slots[index].waveformData = this.extractWaveform(this.slots[index].buffer!, 64);
    this.slots[index].status = 'stopped';
    this.slotRecordBuffers[index] = [];
    this.onSlotChange?.(index, { ...this.slots[index] });
  }

  startSlotPlayback(index: number): void {
    if (!this.ctx || !this.slots[index].buffer || !this.slotGains[index]) return;

    // Always stop any existing playback first
    this.stopSlotPlayback(index);

    this.slots[index].status = 'playing';
    this.onSlotChange?.(index, { ...this.slots[index] });

    const scheduleLoop = () => {
      if (!this.ctx || !this.slots[index].buffer || this.slots[index].status !== 'playing') return;

      // Create a fresh AudioBufferSourceNode each time (they are one-shot)
      const source = this.ctx.createBufferSource();
      source.buffer = this.slots[index].buffer;
      source.connect(this.slotGains[index]!);

      // Calculate start time synced to BPM using sequencer start reference
      let startTime = this.ctx.currentTime;
      if (this.syncToBpm) {
        const nextBar = this.getNextBarTime();
        startTime = Math.max(nextBar, this.ctx.currentTime + 0.01);
      }

      source.start(startTime);
      this.slotSources[index] = source;

      // Schedule next loop iteration
      const bufferDuration = source.buffer!.duration;
      const delay = (startTime - this.ctx.currentTime + bufferDuration) * 1000;

      this.slotLoopTimers[index] = window.setTimeout(() => {
        scheduleLoop();
      }, delay);

      source.onended = () => {
        // Cleanup reference if this source is still the active one
      };
    };

    scheduleLoop();
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

    const recorder = new MediaRecorder(this.masterStreamDest.stream, {
      mimeType: this.getSupportedMimeType()
    });
    this.masterRecordChunks = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.masterRecordChunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(this.masterRecordChunks, { type: recorder.mimeType });
      const ext = recorder.mimeType.includes('mp4') ? 'mp4' : 'webm';
      this.downloadBlob(blob, `retrosynth_${Date.now()}.${ext}`);
      this.masterRecording = false;
      this.onMasterRecordingChange?.(false, 0);
    };

    this.masterRecorder = recorder;
    this.masterRecording = true;
    this.masterRecordStart = Date.now();
    recorder.start(250);

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

  private extractWaveform(buffer: AudioBuffer, bars = 64): number[] {
    const data = buffer.getChannelData(0);
    const blockSize = Math.floor(data.length / bars);
    if (blockSize === 0) return [];
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
