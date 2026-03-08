// Loop Station Engine — 4 loop slots with clean state machine

export type SlotState = 'empty' | 'recording' | 'recorded' | 'playing';

export interface LoopSlot {
  state: SlotState;
  isOverdub: boolean;
  buffer: AudioBuffer | null;
  bars: 1 | 2 | 4 | 8;
  volume: number;
  waveformData: number[];
  startOffset: number; // manual start offset in seconds (0-0.5)
  autoTrimOffset: number; // auto-detected silence trim in seconds
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
  private slotCountInTimers: (number | null)[] = [null, null, null, null];
  private slotPendingRecord: boolean[] = [false, false, false, false]; // track if waiting for count-in
  private slotPreRecordState: SlotState[] = ['empty', 'empty', 'empty', 'empty'];

  // Master recording
  private masterRecorder: MediaRecorder | null = null;
  private masterRecordChunks: Blob[] = [];
  private masterStreamDest: MediaStreamAudioDestinationNode | null = null;
  private masterRecording = false;
  private masterRecordStart = 0;

  // Metronome
  private metronomeEnabled = false;
  private metronomeGain: GainNode | null = null;

  // BPM & sync
  private bpm = 120;
  private syncToBpm = true;
  private sequencerStartTime = 0;
  private sequencerPlaying = false;

  // Callbacks
  private onSlotChange: ((slotIndex: number, slot: LoopSlot) => void) | null = null;
  private onMasterRecordingChange: ((recording: boolean, elapsed: number) => void) | null = null;
  private onCountIn: ((beat: number) => void) | null = null;

  constructor() {
    this.slots = Array.from({ length: 4 }, () => ({
      state: 'empty' as SlotState,
      isOverdub: false,
      buffer: null,
      bars: 2 as 1 | 2 | 4 | 8,
      volume: 0.8,
      waveformData: [],
      startOffset: 0,
      autoTrimOffset: 0,
    }));
  }

  init(ctx: AudioContext, dest: AudioNode, synthMasterGain?: GainNode | null): void {
    this.ctx = ctx;
    this.destination = dest;
    this.synthMasterGain = synthMasterGain || null;

    // Master stream destination for master recording
    this.masterStreamDest = ctx.createMediaStreamDestination();
    if (this.synthMasterGain) {
      this.synthMasterGain.connect(this.masterStreamDest);
    }

    // Metronome gain
    this.metronomeGain = ctx.createGain();
    this.metronomeGain.gain.value = 0.3;
    this.metronomeGain.connect(dest);
    this.metronomeGain.connect(this.masterStreamDest);

    // Slot gains
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
  setSequencerPlaying(playing: boolean): void { this.sequencerPlaying = playing; }

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
    this.emitSlot(index);
  }

  setSlotVolume(index: number, volume: number): void {
    this.slots[index].volume = volume;
    if (this.slotGains[index] && this.ctx) {
      this.slotGains[index]!.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.01);
    }
    this.emitSlot(index);
  }

  private emitSlot(index: number): void {
    this.onSlotChange?.(index, { ...this.slots[index] });
  }

  private getBarDuration(): number {
    return (60 / this.bpm) * 4;
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

  // ─── STATE MACHINE ───────────────────────────────────────────────

  /**
   * Main REC button handler — implements strict state transitions:
   * EMPTY    → count-in (if seq stopped) or sync to bar → RECORDING
   * RECORDED → count-in (if seq stopped) or sync to bar → RECORDING (overdub)
   * PLAYING  → immediate overdub (already in sync) → RECORDING (overdub, continues playing after)
   * RECORDING → cancel → previous state
   */
  handleRecButton(index: number): void {
    const slot = this.slots[index];

    switch (slot.state) {
      case 'empty':
        this.slotPreRecordState[index] = 'empty';
        this.initiateRecording(index, false);
        break;

      case 'recorded':
        this.slotPreRecordState[index] = 'recorded';
        this.initiateRecording(index, true);
        break;

      case 'playing':
        // Immediate overdub — already in sync, no count-in needed
        this.slotPreRecordState[index] = 'playing';
        this.beginActualRecording(index, true);
        break;

      case 'recording':
        // Cancel recording
        this.cancelRecording(index);
        break;
    }
  }

  /**
   * Initiate recording with optional count-in.
   * Count-in only when sequencer is NOT playing.
   * If sequencer IS playing, sync to next bar automatically.
   */
  private initiateRecording(index: number, isOverdub: boolean): void {
    if (!this.ctx || !this.synthMasterGain) return;

    if (this.sequencerPlaying && this.syncToBpm) {
      // Sequencer playing — skip count-in, sync to next bar
      const nextBar = this.getNextBarTime();
      const delay = Math.max(0, (nextBar - this.ctx.currentTime) * 1000);

      this.slotPendingRecord[index] = true;
      this.emitSlot(index); // UI can show "waiting" state

      this.slotCountInTimers[index] = window.setTimeout(() => {
        this.slotPendingRecord[index] = false;
        if (this.slots[index].state === 'empty' || this.slots[index].state === 'recorded') {
          this.beginActualRecording(index, isOverdub);
        }
      }, delay);
    } else {
      // No sequencer — do 4-beat count-in
      this.doCountIn(index, () => {
        this.beginActualRecording(index, isOverdub);
      });
    }
  }

  private doCountIn(index: number, onComplete: () => void): void {
    if (!this.ctx) return;
    const beatDuration = 60 / this.bpm;
    const now = this.ctx.currentTime;
    this.slotPendingRecord[index] = true;

    for (let i = 0; i < 4; i++) {
      const clickTime = now + i * beatDuration;
      this.playMetronomeClick(clickTime, i === 0);
      const beatNum = i + 1;
      setTimeout(() => {
        this.onCountIn?.(beatNum);
      }, i * beatDuration * 1000);
    }

    // After 4 beats, start recording
    const totalDelay = 4 * beatDuration * 1000;
    this.slotCountInTimers[index] = window.setTimeout(() => {
      this.slotPendingRecord[index] = false;
      this.onCountIn?.(0); // clear count-in display
      onComplete();
    }, totalDelay);
  }

  private beginActualRecording(index: number, isOverdub: boolean): void {
    if (!this.ctx || !this.synthMasterGain) return;

    const slot = this.slots[index];

    // Set up ScriptProcessorNode for raw PCM capture (silent tap)
    const bufferSize = 4096;
    const processor = this.ctx.createScriptProcessor(bufferSize, 2, 2);
    this.slotRecordBuffers[index] = [];

    processor.onaudioprocess = (e) => {
      const inputL = e.inputBuffer.getChannelData(0);
      this.slotRecordBuffers[index].push(new Float32Array(inputL));
      // Output silence to prevent double monitoring
      for (let ch = 0; ch < e.outputBuffer.numberOfChannels; ch++) {
        e.outputBuffer.getChannelData(ch).fill(0);
      }
    };

    this.synthMasterGain.connect(processor);
    processor.connect(this.ctx.destination);
    this.slotRecordProcessors[index] = processor;

    // Transition to RECORDING
    slot.state = 'recording';
    slot.isOverdub = isOverdub;
    this.emitSlot(index);

    // Auto-stop after selected bar length
    const recordDuration = this.getBarDuration() * slot.bars;
    this.slotRecordTimers[index] = window.setTimeout(() => {
      this.finishRecording(index);
    }, recordDuration * 1000);
  }

  private finishRecording(index: number): void {
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

    // Build AudioBuffer from captured PCM
    const chunks = this.slotRecordBuffers[index];
    if (chunks.length === 0) {
      // Nothing captured — revert to previous state
      this.slots[index].state = this.slotPreRecordState[index];
      this.slots[index].isOverdub = false;
      this.emitSlot(index);
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
    if (slot.isOverdub && slot.buffer) {
      slot.buffer = this.mixBuffers(slot.buffer, newBuffer);
    } else {
      slot.buffer = newBuffer;
    }

    // Auto-trim leading silence (only on first recording, not overdub)
    if (!slot.isOverdub) {
      slot.autoTrimOffset = this.detectLeadingSilence(slot.buffer!);
    }

    slot.waveformData = this.extractWaveform(slot.buffer!, 64);
    slot.isOverdub = false;
    this.slotRecordBuffers[index] = [];

    // Transition: if was playing before overdub, go back to playing
    if (this.slotPreRecordState[index] === 'playing') {
      slot.state = 'playing';
      this.emitSlot(index);
      // Restart playback with updated buffer
      this.startSlotPlayback(index);
    } else {
      slot.state = 'recorded';
      this.emitSlot(index);
    }
  }

  private cancelRecording(index: number): void {
    // Clear pending timers
    if (this.slotCountInTimers[index] !== null) {
      clearTimeout(this.slotCountInTimers[index]!);
      this.slotCountInTimers[index] = null;
    }
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

    this.slotPendingRecord[index] = false;
    this.slotRecordBuffers[index] = [];

    // Revert to previous state
    this.slots[index].state = this.slotPreRecordState[index];
    this.slots[index].isOverdub = false;
    this.emitSlot(index);
    this.onCountIn?.(0);
  }

  // ─── PLAYBACK ─────────────────────────────────────────────────────

  startSlotPlayback(index: number): void {
    if (!this.ctx || !this.slots[index].buffer || !this.slotGains[index]) return;

    this.stopSlotPlayback(index);

    this.slots[index].state = 'playing';
    this.emitSlot(index);

    const scheduleLoop = () => {
      if (!this.ctx || !this.slots[index].buffer || this.slots[index].state !== 'playing') return;

      const source = this.ctx.createBufferSource();
      source.buffer = this.slots[index].buffer;
      source.connect(this.slotGains[index]!);

      let startTime = this.ctx.currentTime;
      if (this.syncToBpm && this.sequencerPlaying) {
        const nextBar = this.getNextBarTime();
        startTime = Math.max(nextBar, this.ctx.currentTime + 0.01);
      }

      const playOffset = this.slots[index].startOffset + this.slots[index].autoTrimOffset;
      source.start(startTime, playOffset);
      this.slotSources[index] = source;

      const bufferDuration = source.buffer!.duration - playOffset;
      const delay = (startTime - this.ctx.currentTime + bufferDuration) * 1000;

      this.slotLoopTimers[index] = window.setTimeout(() => {
        scheduleLoop();
      }, delay);
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
    if (this.slots[index].state === 'playing') {
      this.slots[index].state = 'recorded';
      this.emitSlot(index);
    }
  }

  toggleSlotPlayback(index: number): void {
    if (this.slots[index].state === 'playing') {
      this.stopSlotPlayback(index);
    } else if (this.slots[index].buffer) {
      this.startSlotPlayback(index);
    }
  }

  setSlotStartOffset(index: number, offset: number): void {
    this.slots[index].startOffset = Math.max(0, Math.min(0.5, offset));
    this.emitSlot(index);
  }

  clearSlot(index: number): void {
    this.stopSlotPlayback(index);
    this.cancelRecording(index);
    this.slots[index] = {
      state: 'empty',
      isOverdub: false,
      buffer: null,
      bars: this.slots[index].bars,
      volume: this.slots[index].volume,
      waveformData: [],
      startOffset: 0,
      autoTrimOffset: 0,
    };
    this.emitSlot(index);
  }

  stopAllSlots(): void {
    for (let i = 0; i < 4; i++) {
      this.stopSlotPlayback(i);
    }
  }

  resumeActiveSlots(): void {
    // reserved for future use
  }

  // ─── MASTER RECORDING ────────────────────────────────────────────

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
    const max = Math.max(...waveform, 0.001);
    return waveform.map(v => v / max);
  }

  destroy(): void {
    this.stopAllSlots();
    this.stopMasterRecording();
    for (let i = 0; i < 4; i++) {
      this.cancelRecording(i);
      this.slotGains[i]?.disconnect();
    }
    this.metronomeGain?.disconnect();
    this.masterStreamDest?.disconnect();
  }
}
