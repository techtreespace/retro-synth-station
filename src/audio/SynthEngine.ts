// Polyphonic Web Audio Synthesizer Engine

export type SynthType = 'analog' | 'wavetable' | 'fm';
export type WaveformType = 'sine' | 'sawtooth' | 'square' | 'triangle';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass';
export type LFOTarget = 'pitch' | 'filter';
export type WavetableType = 'basic' | 'strings' | 'vocal' | 'metallic' | 'pad' | 'bass' | 'lead' | 'noise';

export interface ADSRParams {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface SynthParams {
  type: SynthType;
  masterVolume: number;
  glide: number;
  pitchBend: number;
  modWheel: number;
  waveform: WaveformType;
  pulseWidth: number;
  filterCutoff: number;
  filterResonance: number;
  filterType: FilterType;
  adsr: ADSRParams;
  lfoRate: number;
  lfoDepth: number;
  lfoTarget: LFOTarget;
  wavetableType: WavetableType;
  wavetablePosition: number;
  fmModIndex: number;
  fmCarrierRatio: number;
  fmModRatio: number;
  fmFeedback: number;
  fmModAdsr: ADSRParams;
}

interface Voice {
  note: number;
  oscillator?: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  carrier?: OscillatorNode;
  modulator?: OscillatorNode;
  modGain?: GainNode;
  feedbackGain?: GainNode;
  feedbackDelay?: DelayNode;
  wavetableOsc?: OscillatorNode;
  startTime: number;
  releasing: boolean;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

const RAMP_TIME = 0.005;
const GAIN_FLOOR = 0.0001;

function noteToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function generateWavetable(ctx: AudioContext, type: WavetableType, position: number): PeriodicWave {
  const size = 256;
  const real = new Float32Array(size);
  const imag = new Float32Array(size);
  real[0] = 0;
  imag[0] = 0;
  const p = Math.max(0, Math.min(1, position));

  switch (type) {
    case 'basic':
      for (let i = 1; i < size; i++) { imag[i] = (1 / i) * (1 - p * 0.8); real[i] = (1 / (i * i)) * p; } break;
    case 'strings':
      for (let i = 1; i < size; i++) { imag[i] = (i % 2 === 1 ? 1 : 0.3) / i * (1 - p * 0.5); real[i] = Math.sin(i * p * Math.PI) / (i * 2); } break;
    case 'vocal':
      for (let i = 1; i < size; i++) { const f1 = Math.exp(-Math.pow((i - 3 - p * 5), 2) / 4); const f2 = Math.exp(-Math.pow((i - 8 - p * 3), 2) / 6) * 0.5; imag[i] = (f1 + f2) / i; } break;
    case 'metallic':
      for (let i = 1; i < size; i++) { imag[i] = Math.sin(i * 1.4 + p * 3) / Math.sqrt(i); real[i] = Math.cos(i * 0.7 + p * 2) / (i * 1.5); } break;
    case 'pad':
      for (let i = 1; i < size; i++) { imag[i] = (i <= 8 ? 1 / i : 0) * (1 - p * 0.3); real[i] = (i <= 6 ? 0.5 / (i * i) : 0) * p; } break;
    case 'bass':
      for (let i = 1; i < size; i++) { imag[i] = (i <= 4 ? 1 / i : 1 / (i * i * i)) * (1 + p); } break;
    case 'lead':
      for (let i = 1; i < size; i++) { imag[i] = (1 / i) * (i % 2 === 1 ? 1 : p); real[i] = (1 / (i * i)) * (1 - p) * 0.3; } break;
    case 'noise':
      for (let i = 1; i < size; i++) { imag[i] = (Math.random() * 2 - 1) * (1 / Math.sqrt(i)) * (1 + p); real[i] = (Math.random() * 2 - 1) * (1 / Math.sqrt(i)) * p; } break;
  }

  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

export class SynthEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private voices: Map<number, Voice> = new Map();
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;
  private maxPolyphony = 4;
  private params: SynthParams;
  private initialized = false;

  constructor(initialParams: SynthParams) {
    this.params = { ...initialParams };
  }

  async init(): Promise<void> {
    if (this.initialized) {
      if (this.ctx?.state === 'suspended') {
        await this.ctx.resume();
      }
      return;
    }

    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.params.masterVolume;
    this.masterGain.connect(this.ctx.destination);

    this.lfo = this.ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = this.params.lfoRate;
    this.lfoGain = this.ctx.createGain();
    this.lfoGain.gain.value = 0;
    this.lfo.connect(this.lfoGain);
    this.lfo.start();

    this.initialized = true;
  }

  updateParams(newParams: Partial<SynthParams>): void {
    this.params = { ...this.params, ...newParams };
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(this.params.masterVolume, now, 0.01);
    if (this.lfo) this.lfo.frequency.setTargetAtTime(this.params.lfoRate, now, 0.01);

    this.voices.forEach((voice) => {
      if (!voice.releasing) {
        voice.filter.frequency.setTargetAtTime(this.params.filterCutoff, now, 0.01);
        voice.filter.Q.setTargetAtTime(this.params.filterResonance, now, 0.01);
        voice.filter.type = this.params.filterType;
      }
    });
  }

  noteOn(note: number): void {
    if (!this.ctx || !this.masterGain) return;

    // Bug 2 fix: if note already active, force-stop it first
    if (this.voices.has(note)) {
      this.forceStopVoice(note);
    }

    // Enforce polyphony
    if (this.voices.size >= this.maxPolyphony) {
      const oldest = this.voices.entries().next().value;
      if (oldest) this.forceStopVoice(oldest[0]);
    }

    const now = this.ctx.currentTime;
    const freq = noteToFreq(note) * Math.pow(2, this.params.pitchBend / 12);

    const voice: Voice = {
      note,
      gain: this.ctx.createGain(),
      filter: this.ctx.createBiquadFilter(),
      startTime: now,
      releasing: false,
    };

    voice.filter.type = this.params.filterType;
    voice.filter.frequency.value = this.params.filterCutoff;
    voice.filter.Q.value = this.params.filterResonance;

    // Bug 3 fix: use exponentialRampToValueAtTime with GAIN_FLOOR
    voice.gain.gain.setValueAtTime(GAIN_FLOOR, now);
    voice.gain.gain.exponentialRampToValueAtTime(1, now + Math.max(this.params.adsr.attack, RAMP_TIME));
    const sustainLevel = Math.max(this.params.adsr.sustain, GAIN_FLOOR);
    voice.gain.gain.exponentialRampToValueAtTime(
      sustainLevel,
      now + this.params.adsr.attack + Math.max(this.params.adsr.decay, RAMP_TIME)
    );

    voice.filter.connect(voice.gain);
    voice.gain.connect(this.masterGain!);

    if (this.lfoGain && this.params.lfoDepth > 0) {
      const lfoAmount = this.ctx.createGain();
      lfoAmount.gain.value = this.params.lfoTarget === 'pitch'
        ? this.params.lfoDepth * 50 * (1 + this.params.modWheel)
        : this.params.lfoDepth * 2000 * (1 + this.params.modWheel);
      this.lfoGain.connect(lfoAmount);
      if (this.params.lfoTarget === 'filter') {
        lfoAmount.connect(voice.filter.frequency);
      }
    }

    switch (this.params.type) {
      case 'analog': this.createAnalogVoice(voice, freq, now); break;
      case 'wavetable': this.createWavetableVoice(voice, freq, now); break;
      case 'fm': this.createFMVoice(voice, freq, now); break;
    }

    this.voices.set(note, voice);
  }

  private createAnalogVoice(voice: Voice, freq: number, now: number): void {
    if (!this.ctx) return;
    voice.oscillator = this.ctx.createOscillator();
    voice.oscillator.type = this.params.waveform;
    voice.oscillator.frequency.setValueAtTime(freq, now);

    if (this.lfoGain && this.params.lfoDepth > 0 && this.params.lfoTarget === 'pitch') {
      const lfoToPitch = this.ctx.createGain();
      lfoToPitch.gain.value = this.params.lfoDepth * 50;
      this.lfoGain.connect(lfoToPitch);
      lfoToPitch.connect(voice.oscillator.frequency);
    }

    voice.oscillator.connect(voice.filter);
    voice.oscillator.start(now);
  }

  private createWavetableVoice(voice: Voice, freq: number, now: number): void {
    if (!this.ctx) return;
    voice.wavetableOsc = this.ctx.createOscillator();
    const wave = generateWavetable(this.ctx, this.params.wavetableType, this.params.wavetablePosition);
    voice.wavetableOsc.setPeriodicWave(wave);
    voice.wavetableOsc.frequency.setValueAtTime(freq, now);

    if (this.lfoGain && this.params.lfoDepth > 0 && this.params.lfoTarget === 'pitch') {
      const lfoToPitch = this.ctx.createGain();
      lfoToPitch.gain.value = this.params.lfoDepth * 50;
      this.lfoGain.connect(lfoToPitch);
      lfoToPitch.connect(voice.wavetableOsc.frequency);
    }

    voice.wavetableOsc.connect(voice.filter);
    voice.wavetableOsc.start(now);
  }

  private createFMVoice(voice: Voice, freq: number, now: number): void {
    if (!this.ctx) return;

    const carrierFreq = freq * this.params.fmCarrierRatio;
    const modFreq = freq * this.params.fmModRatio;
    const modAmt = this.params.fmModIndex * modFreq;

    voice.modulator = this.ctx.createOscillator();
    voice.modulator.type = 'sine';
    voice.modulator.frequency.setValueAtTime(modFreq, now);

    voice.modGain = this.ctx.createGain();
    voice.modGain.gain.setValueAtTime(GAIN_FLOOR, now);
    voice.modGain.gain.exponentialRampToValueAtTime(
      Math.max(modAmt, GAIN_FLOOR),
      now + Math.max(this.params.fmModAdsr.attack, RAMP_TIME)
    );
    voice.modGain.gain.exponentialRampToValueAtTime(
      Math.max(modAmt * this.params.fmModAdsr.sustain, GAIN_FLOOR),
      now + this.params.fmModAdsr.attack + Math.max(this.params.fmModAdsr.decay, RAMP_TIME)
    );

    if (this.params.fmFeedback > 0) {
      voice.feedbackGain = this.ctx.createGain();
      voice.feedbackGain.gain.value = this.params.fmFeedback * modFreq * 0.5;
      voice.feedbackDelay = this.ctx.createDelay();
      voice.feedbackDelay.delayTime.value = 1 / modFreq;
      voice.modulator.connect(voice.feedbackGain);
      voice.feedbackGain.connect(voice.feedbackDelay);
      voice.feedbackDelay.connect(voice.modulator.frequency);
    }

    voice.carrier = this.ctx.createOscillator();
    voice.carrier.type = 'sine';
    voice.carrier.frequency.setValueAtTime(carrierFreq, now);

    voice.modulator.connect(voice.modGain);
    voice.modGain.connect(voice.carrier.frequency);

    if (this.lfoGain && this.params.lfoDepth > 0 && this.params.lfoTarget === 'pitch') {
      const lfoToPitch = this.ctx.createGain();
      lfoToPitch.gain.value = this.params.lfoDepth * 50;
      this.lfoGain.connect(lfoToPitch);
      lfoToPitch.connect(voice.carrier.frequency);
    }

    voice.carrier.connect(voice.filter);
    voice.modulator.start(now);
    voice.carrier.start(now);
  }

  noteOff(note: number): void {
    const voice = this.voices.get(note);
    if (!voice || !this.ctx || voice.releasing) return;

    const now = this.ctx.currentTime;
    const releaseTime = Math.max(this.params.adsr.release, RAMP_TIME);

    voice.releasing = true;

    // Bug 3 fix: exponentialRamp to GAIN_FLOOR instead of linear to 0
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, GAIN_FLOOR), now);
    voice.gain.gain.exponentialRampToValueAtTime(GAIN_FLOOR, now + releaseTime);

    if (voice.modGain) {
      voice.modGain.gain.cancelScheduledValues(now);
      voice.modGain.gain.setValueAtTime(Math.max(voice.modGain.gain.value, GAIN_FLOOR), now);
      voice.modGain.gain.exponentialRampToValueAtTime(GAIN_FLOOR, now + releaseTime);
    }

    const stopTime = now + releaseTime + 0.05;
    voice.cleanupTimer = setTimeout(() => {
      this.cleanupVoice(voice, note);
    }, (stopTime - now) * 1000);
  }

  /** Immediately kill a voice with a fast ramp (for voice stealing / panic) */
  private forceStopVoice(note: number): void {
    const voice = this.voices.get(note);
    if (!voice || !this.ctx) return;

    if (voice.cleanupTimer) clearTimeout(voice.cleanupTimer);

    const now = this.ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, GAIN_FLOOR), now);
    voice.gain.gain.exponentialRampToValueAtTime(GAIN_FLOOR, now + RAMP_TIME);

    setTimeout(() => {
      this.cleanupVoice(voice, note);
    }, RAMP_TIME * 1000 + 50);
  }

  private cleanupVoice(voice: Voice, note: number): void {
    try { voice.oscillator?.stop(); voice.oscillator?.disconnect(); } catch {}
    try { voice.carrier?.stop(); voice.carrier?.disconnect(); } catch {}
    try { voice.modulator?.stop(); voice.modulator?.disconnect(); } catch {}
    try { voice.wavetableOsc?.stop(); voice.wavetableOsc?.disconnect(); } catch {}
    try { voice.modGain?.disconnect(); } catch {}
    try { voice.feedbackGain?.disconnect(); voice.feedbackDelay?.disconnect(); } catch {}
    try { voice.filter.disconnect(); } catch {}
    try { voice.gain.disconnect(); } catch {}
    this.voices.delete(note);
  }

  panic(): void {
    if (!this.ctx) return;
    // Immediately silence everything
    this.voices.forEach((voice, note) => {
      if (voice.cleanupTimer) clearTimeout(voice.cleanupTimer);
      this.cleanupVoice(voice, note);
    });
    // Also cut master gain briefly
    if (this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.setValueAtTime(0, now);
      this.masterGain.gain.setValueAtTime(this.params.masterVolume, now + 0.05);
    }
  }

  /** Release all currently playing notes */
  releaseAll(): void {
    const notes = Array.from(this.voices.keys());
    for (const note of notes) {
      this.noteOff(note);
    }
  }

  getActiveNotes(): number[] {
    return Array.from(this.voices.keys());
  }

  getParams(): SynthParams {
    return { ...this.params };
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
