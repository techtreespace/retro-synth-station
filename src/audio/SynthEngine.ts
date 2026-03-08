// Polyphonic Web Audio Synthesizer Engine
// Supports Analog (subtractive), Wavetable, and FM synthesis

export type SynthType = 'analog' | 'wavetable' | 'fm';
export type WaveformType = 'sine' | 'sawtooth' | 'square' | 'triangle';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass';
export type LFOTarget = 'pitch' | 'filter';
export type WavetableType = 'basic' | 'strings' | 'vocal' | 'metallic' | 'pad' | 'bass' | 'lead' | 'noise';

export interface ADSRParams {
  attack: number;   // 0-2s
  decay: number;    // 0-2s
  sustain: number;  // 0-1
  release: number;  // 0-4s
}

export interface SynthParams {
  type: SynthType;
  masterVolume: number; // 0-1
  glide: number;        // 0-1
  pitchBend: number;    // -1 to 1
  modWheel: number;     // 0-1

  // Analog
  waveform: WaveformType;
  pulseWidth: number;

  // Filter
  filterCutoff: number;    // 20-20000
  filterResonance: number; // 0-30
  filterType: FilterType;

  // ADSR
  adsr: ADSRParams;

  // LFO
  lfoRate: number;    // 0.1-20
  lfoDepth: number;   // 0-1
  lfoTarget: LFOTarget;

  // Wavetable
  wavetableType: WavetableType;
  wavetablePosition: number; // 0-1

  // FM
  fmModIndex: number;     // 0-10
  fmCarrierRatio: number; // 1,2,3,4,8
  fmModRatio: number;     // 1,2,3,4,8
  fmFeedback: number;     // 0-1
  fmModAdsr: ADSRParams;
}

interface Voice {
  note: number;
  oscillator?: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  // FM specific
  carrier?: OscillatorNode;
  modulator?: OscillatorNode;
  modGain?: GainNode;
  feedbackGain?: GainNode;
  feedbackDelay?: DelayNode;
  // Wavetable
  wavetableOsc?: OscillatorNode;
  startTime: number;
  releasing: boolean;
}

const RAMP_TIME = 0.005; // 5ms anti-click

function noteToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

// Generate wavetable PeriodicWave data
function generateWavetable(ctx: AudioContext, type: WavetableType, position: number): PeriodicWave {
  const size = 256;
  const real = new Float32Array(size);
  const imag = new Float32Array(size);
  real[0] = 0;
  imag[0] = 0;

  const p = Math.max(0, Math.min(1, position));

  switch (type) {
    case 'basic':
      for (let i = 1; i < size; i++) {
        imag[i] = (1 / i) * (1 - p * 0.8);
        real[i] = (1 / (i * i)) * p;
      }
      break;
    case 'strings':
      for (let i = 1; i < size; i++) {
        imag[i] = (i % 2 === 1 ? 1 : 0.3) / i * (1 - p * 0.5);
        real[i] = Math.sin(i * p * Math.PI) / (i * 2);
      }
      break;
    case 'vocal':
      for (let i = 1; i < size; i++) {
        const formant1 = Math.exp(-Math.pow((i - 3 - p * 5), 2) / 4);
        const formant2 = Math.exp(-Math.pow((i - 8 - p * 3), 2) / 6) * 0.5;
        imag[i] = (formant1 + formant2) / i;
      }
      break;
    case 'metallic':
      for (let i = 1; i < size; i++) {
        imag[i] = Math.sin(i * 1.4 + p * 3) / Math.sqrt(i);
        real[i] = Math.cos(i * 0.7 + p * 2) / (i * 1.5);
      }
      break;
    case 'pad':
      for (let i = 1; i < size; i++) {
        imag[i] = (i <= 8 ? 1 / i : 0) * (1 - p * 0.3);
        real[i] = (i <= 6 ? 0.5 / (i * i) : 0) * p;
      }
      break;
    case 'bass':
      for (let i = 1; i < size; i++) {
        imag[i] = (i <= 4 ? 1 / i : 1 / (i * i * i)) * (1 + p);
      }
      break;
    case 'lead':
      for (let i = 1; i < size; i++) {
        imag[i] = (1 / i) * (i % 2 === 1 ? 1 : p);
        real[i] = (1 / (i * i)) * (1 - p) * 0.3;
      }
      break;
    case 'noise':
      for (let i = 1; i < size; i++) {
        imag[i] = (Math.random() * 2 - 1) * (1 / Math.sqrt(i)) * (1 + p);
        real[i] = (Math.random() * 2 - 1) * (1 / Math.sqrt(i)) * p;
      }
      break;
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
    
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.params.masterVolume;
    this.masterGain.connect(this.ctx.destination);

    // Setup LFO
    this.lfo = this.ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = this.params.lfoRate;
    this.lfoGain = this.ctx.createGain();
    this.lfoGain.gain.value = 0; // Will be set per voice
    this.lfo.connect(this.lfoGain);
    this.lfo.start();

    this.initialized = true;
  }

  updateParams(newParams: Partial<SynthParams>): void {
    this.params = { ...this.params, ...newParams };
    
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(this.params.masterVolume, now, 0.01);

    if (this.lfo) {
      this.lfo.frequency.setTargetAtTime(this.params.lfoRate, now, 0.01);
    }

    // Update active voices' filters
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

    // If voice already playing this note, stop it
    if (this.voices.has(note)) {
      this.stopVoice(note);
    }

    // Enforce polyphony - steal oldest voice
    if (this.voices.size >= this.maxPolyphony) {
      const oldest = this.voices.entries().next().value;
      if (oldest) {
        this.stopVoice(oldest[0]);
      }
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

    // Setup filter
    voice.filter.type = this.params.filterType;
    voice.filter.frequency.value = this.params.filterCutoff;
    voice.filter.Q.value = this.params.filterResonance;

    // Setup gain ADSR
    voice.gain.gain.setValueAtTime(0, now);
    voice.gain.gain.linearRampToValueAtTime(1, now + Math.max(this.params.adsr.attack, RAMP_TIME));
    voice.gain.gain.linearRampToValueAtTime(
      this.params.adsr.sustain,
      now + this.params.adsr.attack + Math.max(this.params.adsr.decay, RAMP_TIME)
    );

    // Connect chain: source -> filter -> gain -> master
    voice.filter.connect(voice.gain);
    voice.gain.connect(this.masterGain!);

    // LFO routing
    if (this.lfoGain && this.params.lfoDepth > 0) {
      const lfoAmount = this.ctx.createGain();
      if (this.params.lfoTarget === 'pitch') {
        lfoAmount.gain.value = this.params.lfoDepth * 50 * (1 + this.params.modWheel);
      } else {
        lfoAmount.gain.value = this.params.lfoDepth * 2000 * (1 + this.params.modWheel);
      }
      this.lfoGain.connect(lfoAmount);
      
      if (this.params.lfoTarget === 'filter') {
        lfoAmount.connect(voice.filter.frequency);
      }
    }

    // Create oscillator based on synth type
    switch (this.params.type) {
      case 'analog':
        this.createAnalogVoice(voice, freq, now);
        break;
      case 'wavetable':
        this.createWavetableVoice(voice, freq, now);
        break;
      case 'fm':
        this.createFMVoice(voice, freq, now);
        break;
    }

    this.voices.set(note, voice);
  }

  private createAnalogVoice(voice: Voice, freq: number, now: number): void {
    if (!this.ctx) return;
    voice.oscillator = this.ctx.createOscillator();
    voice.oscillator.type = this.params.waveform;
    voice.oscillator.frequency.setValueAtTime(freq, now);

    // LFO -> pitch
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

    // Modulator
    voice.modulator = this.ctx.createOscillator();
    voice.modulator.type = 'sine';
    voice.modulator.frequency.setValueAtTime(modFreq, now);

    // Modulator gain (modulation depth)
    voice.modGain = this.ctx.createGain();
    // Apply modulator ADSR to modGain
    voice.modGain.gain.setValueAtTime(0, now);
    voice.modGain.gain.linearRampToValueAtTime(
      modAmt,
      now + Math.max(this.params.fmModAdsr.attack, RAMP_TIME)
    );
    voice.modGain.gain.linearRampToValueAtTime(
      modAmt * this.params.fmModAdsr.sustain,
      now + this.params.fmModAdsr.attack + Math.max(this.params.fmModAdsr.decay, RAMP_TIME)
    );

    // Feedback
    if (this.params.fmFeedback > 0) {
      voice.feedbackGain = this.ctx.createGain();
      voice.feedbackGain.gain.value = this.params.fmFeedback * modFreq * 0.5;
      voice.feedbackDelay = this.ctx.createDelay();
      voice.feedbackDelay.delayTime.value = 1 / modFreq;
      voice.modulator.connect(voice.feedbackGain);
      voice.feedbackGain.connect(voice.feedbackDelay);
      voice.feedbackDelay.connect(voice.modulator.frequency);
    }

    // Carrier
    voice.carrier = this.ctx.createOscillator();
    voice.carrier.type = 'sine';
    voice.carrier.frequency.setValueAtTime(carrierFreq, now);

    // Connect: modulator -> modGain -> carrier.frequency
    voice.modulator.connect(voice.modGain);
    voice.modGain.connect(voice.carrier.frequency);

    // LFO -> carrier pitch
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
    if (!voice || !this.ctx) return;

    const now = this.ctx.currentTime;
    const releaseTime = Math.max(this.params.adsr.release, RAMP_TIME);

    voice.releasing = true;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0, now + releaseTime);

    // FM modulator release
    if (voice.modGain) {
      voice.modGain.gain.cancelScheduledValues(now);
      voice.modGain.gain.setValueAtTime(voice.modGain.gain.value, now);
      voice.modGain.gain.linearRampToValueAtTime(0, now + releaseTime);
    }

    // Schedule cleanup
    const stopTime = now + releaseTime + 0.05;
    const cleanup = () => {
      try {
        voice.oscillator?.stop();
        voice.oscillator?.disconnect();
      } catch {}
      try {
        voice.carrier?.stop();
        voice.carrier?.disconnect();
      } catch {}
      try {
        voice.modulator?.stop();
        voice.modulator?.disconnect();
      } catch {}
      try {
        voice.wavetableOsc?.stop();
        voice.wavetableOsc?.disconnect();
      } catch {}
      try {
        voice.modGain?.disconnect();
        voice.feedbackGain?.disconnect();
        voice.feedbackDelay?.disconnect();
      } catch {}
      voice.filter.disconnect();
      voice.gain.disconnect();
      this.voices.delete(note);
    };

    setTimeout(cleanup, (stopTime - now) * 1000);
  }

  private stopVoice(note: number): void {
    const voice = this.voices.get(note);
    if (!voice || !this.ctx) return;

    const now = this.ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0, now + RAMP_TIME);

    setTimeout(() => {
      try { voice.oscillator?.stop(); voice.oscillator?.disconnect(); } catch {}
      try { voice.carrier?.stop(); voice.carrier?.disconnect(); } catch {}
      try { voice.modulator?.stop(); voice.modulator?.disconnect(); } catch {}
      try { voice.wavetableOsc?.stop(); voice.wavetableOsc?.disconnect(); } catch {}
      try { voice.modGain?.disconnect(); } catch {}
      try { voice.feedbackGain?.disconnect(); voice.feedbackDelay?.disconnect(); } catch {}
      voice.filter.disconnect();
      voice.gain.disconnect();
      this.voices.delete(note);
    }, RAMP_TIME * 1000 + 50);
  }

  panic(): void {
    this.voices.forEach((_, note) => this.stopVoice(note));
  }

  getParams(): SynthParams {
    return { ...this.params };
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
