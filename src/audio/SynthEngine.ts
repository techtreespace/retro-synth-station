// Polyphonic Web Audio Synthesizer Engine
// Complete rewrite with proper voice pool management

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
  distortion: number; // 0-100
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

interface VoiceNodes {
  oscillators: OscillatorNode[];  // all oscs to stop
  gainNode: GainNode;             // voice amplitude
  filter: BiquadFilterNode;
  waveshaper?: WaveShaperNode;
  distCompGain?: GainNode;
  allNodes: AudioNode[];          // everything to disconnect
}

function createDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const samples = 256;
  const buffer = new ArrayBuffer(samples * 4);
  const curve = new Float32Array(buffer);
  const deg = Math.PI / 180;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    if (amount === 0) {
      curve[i] = x;
    } else {
      curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
  }
  return curve;
}

const MAX_VOICES = 8;

function noteToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function generateWavetable(ctx: AudioContext, type: WavetableType, position: number): PeriodicWave {
  const size = 256;
  const real = new Float32Array(size);
  const imag = new Float32Array(size);
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
  private voices: Map<number, VoiceNodes> = new Map();
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;
  private params: SynthParams;
  private initialized = false;

  constructor(initialParams: SynthParams) {
    this.params = { ...initialParams };
  }

  async init(): Promise<void> {
    if (this.initialized && this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    this.buildContext();
    this.initialized = true;
  }

  private buildContext(): void {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.params.masterVolume;
    this.masterGain.connect(this.ctx.destination);

    this.lfo = this.ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = this.params.lfoRate;
    this.lfoGain = this.ctx.createGain();
    this.lfoGain.gain.value = 1;
    this.lfo.connect(this.lfoGain);
    this.lfo.start();
  }

  updateParams(newParams: Partial<SynthParams>): void {
    this.params = { ...this.params, ...newParams };
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(this.params.masterVolume, now, 0.01);
    if (this.lfo) this.lfo.frequency.setTargetAtTime(this.params.lfoRate, now, 0.01);

    this.voices.forEach((voice) => {
      voice.filter.frequency.setTargetAtTime(this.params.filterCutoff, now, 0.01);
      voice.filter.Q.setTargetAtTime(this.params.filterResonance, now, 0.01);
      voice.filter.type = this.params.filterType;
      // Update distortion curve and compensation gain in real time
      if (voice.waveshaper) {
        voice.waveshaper.curve = createDistortionCurve(this.params.distortion);
      }
      if (voice.distCompGain) {
        const outputGain = 1.0 - (this.params.distortion / 100) * 0.35;
        voice.distCompGain.gain.setTargetAtTime(outputGain, now, 0.01);
      }
    });
  }

  noteOn(note: number, velocity: number = 127): void {
    if (!this.ctx || !this.masterGain) return;

    // 1. If already playing, stop it first
    if (this.voices.has(note)) {
      this.doNoteOff(note);
    }

    // 2. Steal oldest if at max polyphony
    if (this.voices.size >= MAX_VOICES) {
      const oldestKey = this.voices.keys().next().value;
      if (oldestKey !== undefined) this.doNoteOff(oldestKey);
    }

    const now = this.ctx.currentTime;
    const freq = noteToFreq(note) * Math.pow(2, this.params.pitchBend / 12);
    const { attack, decay, sustain } = this.params.adsr;
    const velGain = Math.max(0, Math.min(1, velocity / 127));

    // Per-waveform loudness compensation (analog only)
    const WAVEFORM_COMPENSATION: Record<string, number> = {
      'sine': 1.45,
      'triangle': 1.25,
      'sawtooth': 0.72,
      'square': 0.60,
    };
    const waveComp = this.params.type === 'analog'
      ? (WAVEFORM_COMPENSATION[this.params.waveform] ?? 1.0)
      : 1.0;

    // Create voice gain
    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.7 * velGain * waveComp, now + Math.max(attack, 0.003));
    gainNode.gain.linearRampToValueAtTime(Math.max(sustain, 0.001) * 0.7 * velGain * waveComp, now + Math.max(attack, 0.003) + Math.max(decay, 0.003));

    // Create filter
    const filter = this.ctx.createBiquadFilter();
    filter.type = this.params.filterType;
    filter.frequency.value = this.params.filterCutoff;
    filter.Q.value = this.params.filterResonance;

    filter.connect(gainNode);
    gainNode.connect(this.masterGain);

    const oscillators: OscillatorNode[] = [];
    const allNodes: AudioNode[] = [gainNode, filter];
    let wsRef: WaveShaperNode | undefined;
    let dcRef: GainNode | undefined;

    // Build oscillator(s) based on synth type
    switch (this.params.type) {
      case 'analog': {
        const osc = this.ctx.createOscillator();
        osc.type = this.params.waveform;
        osc.frequency.setValueAtTime(freq, now);
        this.connectLFOToPitch(osc, now);

        // Distortion: osc → waveshaper → distCompGain → filter
        const waveshaper = this.ctx.createWaveShaper();
        waveshaper.curve = createDistortionCurve(this.params.distortion);
        waveshaper.oversample = '4x';
        const distCompGain = this.ctx.createGain();
        const outputGain = 1.0 - (this.params.distortion / 100) * 0.35;
        distCompGain.gain.setValueAtTime(outputGain, now);

        osc.connect(waveshaper);
        waveshaper.connect(distCompGain);
        distCompGain.connect(filter);

        osc.start(now);
        oscillators.push(osc);
        allNodes.push(osc, waveshaper, distCompGain);
        wsRef = waveshaper;
        dcRef = distCompGain;
        break;
      }
      case 'wavetable': {
        const osc = this.ctx.createOscillator();
        const wave = generateWavetable(this.ctx, this.params.wavetableType, this.params.wavetablePosition);
        osc.setPeriodicWave(wave);
        osc.frequency.setValueAtTime(freq, now);
        this.connectLFOToPitch(osc, now);
        osc.connect(filter);
        osc.start(now);
        oscillators.push(osc);
        allNodes.push(osc);
        break;
      }
      case 'fm': {
        const carrierFreq = freq * this.params.fmCarrierRatio;
        const modFreq = freq * this.params.fmModRatio;
        const modAmt = this.params.fmModIndex * modFreq;

        const modulator = this.ctx.createOscillator();
        modulator.type = 'sine';
        modulator.frequency.setValueAtTime(modFreq, now);

        const modGain = this.ctx.createGain();
        const { attack: mA, decay: mD, sustain: mS } = this.params.fmModAdsr;
        modGain.gain.setValueAtTime(0, now);
        modGain.gain.linearRampToValueAtTime(modAmt, now + Math.max(mA, 0.003));
        modGain.gain.linearRampToValueAtTime(Math.max(modAmt * mS, 0.001), now + Math.max(mA, 0.003) + Math.max(mD, 0.003));

        modulator.connect(modGain);

        const carrier = this.ctx.createOscillator();
        carrier.type = 'sine';
        carrier.frequency.setValueAtTime(carrierFreq, now);

        modGain.connect(carrier.frequency);
        this.connectLFOToPitch(carrier, now);
        carrier.connect(filter);

        modulator.start(now);
        carrier.start(now);
        oscillators.push(modulator, carrier);
        allNodes.push(modulator, carrier, modGain);

        // Feedback
        if (this.params.fmFeedback > 0) {
          const fbGain = this.ctx.createGain();
          fbGain.gain.value = this.params.fmFeedback * modFreq * 0.5;
          const fbDelay = this.ctx.createDelay();
          fbDelay.delayTime.value = 1 / Math.max(modFreq, 20);
          modulator.connect(fbGain);
          fbGain.connect(fbDelay);
          fbDelay.connect(modulator.frequency);
          allNodes.push(fbGain, fbDelay);
        }
        break;
      }
    }

    // LFO to filter
    if (this.lfoGain && this.params.lfoDepth > 0 && this.params.lfoTarget === 'filter') {
      const lfoAmt = this.ctx.createGain();
      lfoAmt.gain.value = this.params.lfoDepth * 2000 * (1 + this.params.modWheel);
      this.lfoGain.connect(lfoAmt);
      lfoAmt.connect(filter.frequency);
      allNodes.push(lfoAmt);
    }

    this.voices.set(note, { oscillators, gainNode, filter, waveshaper: wsRef, distCompGain: dcRef, allNodes });
  }

  private connectLFOToPitch(osc: OscillatorNode, _now: number): void {
    if (!this.ctx || !this.lfoGain || this.params.lfoDepth <= 0 || this.params.lfoTarget !== 'pitch') return;
    const lfoAmt = this.ctx.createGain();
    lfoAmt.gain.value = this.params.lfoDepth * 50 * (1 + this.params.modWheel);
    this.lfoGain.connect(lfoAmt);
    lfoAmt.connect(osc.frequency);
  }

  noteOff(note: number): void {
    this.doNoteOff(note);
  }

  private doNoteOff(note: number): void {
    const voice = this.voices.get(note);
    if (!voice) return; // Guard clause

    // Remove from map IMMEDIATELY to prevent double-trigger
    this.voices.delete(note);

    if (!this.ctx) {
      // Context gone, just cleanup
      this.disconnectVoice(voice);
      return;
    }

    const now = this.ctx.currentTime;
    const release = Math.max(this.params.adsr.release, 0.01);

    // Release envelope
    voice.gainNode.gain.cancelScheduledValues(now);
    voice.gainNode.gain.setValueAtTime(Math.max(voice.gainNode.gain.value, 0.0001), now);
    voice.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + release);

    // Schedule oscillator stop AFTER release
    const stopTime = now + release + 0.02;
    for (const osc of voice.oscillators) {
      try { osc.stop(stopTime); } catch {}
    }

    // Cleanup after oscillators end
    const cleanupMs = (release + 0.05) * 1000;
    setTimeout(() => {
      this.disconnectVoice(voice);
    }, cleanupMs);
  }

  private disconnectVoice(voice: VoiceNodes): void {
    for (const node of voice.allNodes) {
      try { node.disconnect(); } catch {}
    }
  }

  releaseAll(): void {
    const notes = Array.from(this.voices.keys());
    for (const note of notes) {
      this.doNoteOff(note);
    }
  }

  panic(): void {
    // Immediately disconnect everything
    this.voices.forEach((voice) => {
      for (const osc of voice.oscillators) {
        try { osc.stop(); } catch {}
      }
      this.disconnectVoice(voice);
    });
    this.voices.clear();

    // Nuke and rebuild context
    if (this.ctx) {
      try { this.lfo?.stop(); } catch {}
      try { this.lfo?.disconnect(); } catch {}
      try { this.lfoGain?.disconnect(); } catch {}
      try { this.masterGain?.disconnect(); } catch {}
      this.ctx.close().catch(() => {});
    }
    this.buildContext();
  }

  getParams(): SynthParams { return { ...this.params }; }
  isInitialized(): boolean { return this.initialized; }
  getActiveNoteCount(): number { return this.voices.size; }
  getAudioContext(): AudioContext | null { return this.ctx; }
  getMasterGain(): GainNode | null { return this.masterGain; }
}
