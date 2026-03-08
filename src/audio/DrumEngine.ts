// Programmatic drum synthesis using Web Audio API - no samples needed

export type DrumSound = 'kick' | 'snare' | 'hihat-closed' | 'hihat-open' | 'clap' | 'perc';

export const DRUM_SOUNDS: { id: DrumSound; label: string }[] = [
  { id: 'kick', label: 'KICK' },
  { id: 'snare', label: 'SNARE' },
  { id: 'hihat-closed', label: 'CH' },
  { id: 'hihat-open', label: 'OH' },
  { id: 'clap', label: 'CLAP' },
  { id: 'perc', label: 'PERC' },
];

// Per-sound parameter definitions
export interface DrumSoundParams {
  param1: number; // PITCH for all
  param2: number; // DECAY/SNAP/TIGHT/RING/SHAPE
  param3: number; // DIST/TONE/ROOM/etc
}

export interface DrumParamDef {
  label1: string; min1: number; max1: number; default1: number; unit1?: string;
  label2: string; min2: number; max2: number; default2: number; unit2?: string;
  label3: string; min3: number; max3: number; default3: number; unit3?: string;
}

export const DRUM_PARAM_DEFS: Record<DrumSound, DrumParamDef> = {
  kick: {
    label1: 'PITCH', min1: 40, max1: 120, default1: 60,
    label2: 'DECAY', min2: 0.1, max2: 1.5, default2: 0.5,
    label3: 'DIST', min3: 0, max3: 100, default3: 0,
  },
  snare: {
    label1: 'PITCH', min1: 200, max1: 600, default1: 300,
    label2: 'SNAP', min2: 0, max2: 100, default2: 50,
    label3: 'TONE', min3: 0, max3: 100, default3: 50,
  },
  'hihat-closed': {
    label1: 'PITCH', min1: 6000, max1: 12000, default1: 8000,
    label2: 'DECAY', min2: 0.02, max2: 0.15, default2: 0.05,
    label3: 'TIGHT', min3: 0, max3: 100, default3: 50,
  },
  'hihat-open': {
    label1: 'PITCH', min1: 6000, max1: 12000, default1: 8000,
    label2: 'DECAY', min2: 0.1, max2: 0.8, default2: 0.3,
    label3: 'RING', min3: 0, max3: 100, default3: 50,
  },
  clap: {
    label1: 'PITCH', min1: 800, max1: 2400, default1: 1200,
    label2: 'DECAY', min2: 0.05, max2: 0.3, default2: 0.1,
    label3: 'ROOM', min3: 0, max3: 100, default3: 30,
  },
  perc: {
    label1: 'PITCH', min1: 200, max1: 2000, default1: 800,
    label2: 'DECAY', min2: 0.05, max2: 0.5, default2: 0.2,
    label3: 'SHAPE', min3: 0, max3: 100, default3: 0,
  },
};

export function getDefaultDrumParams(): Record<DrumSound, DrumSoundParams> {
  const result: Partial<Record<DrumSound, DrumSoundParams>> = {};
  for (const s of DRUM_SOUNDS) {
    const def = DRUM_PARAM_DEFS[s.id];
    result[s.id] = { param1: def.default1, param2: def.default2, param3: def.default3 };
  }
  return result as Record<DrumSound, DrumSoundParams>;
}

export class DrumEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private trackVolumes: Map<DrumSound, number> = new Map();
  private soundParams: Record<DrumSound, DrumSoundParams>;
  private noiseBuffer: AudioBuffer | null = null;

  constructor() {
    DRUM_SOUNDS.forEach(s => this.trackVolumes.set(s.id, 0.8));
    this.soundParams = getDefaultDrumParams();
  }

  init(ctx: AudioContext, destination: AudioNode, recordingDest?: AudioNode | null): void {
    this.ctx = ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.9;
    this.masterGain.connect(destination);
    if (recordingDest) {
      this.masterGain.connect(recordingDest);
    }
    this.noiseBuffer = this.createNoiseBuffer();
  }

  private createNoiseBuffer(): AudioBuffer {
    if (!this.ctx) throw new Error('No context');
    const length = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  setTrackVolume(sound: DrumSound, volume: number): void {
    this.trackVolumes.set(sound, volume);
  }

  getTrackVolume(sound: DrumSound): number {
    return this.trackVolumes.get(sound) ?? 0.8;
  }

  setSoundParams(sound: DrumSound, params: DrumSoundParams): void {
    this.soundParams[sound] = { ...params };
  }

  getSoundParams(sound: DrumSound): DrumSoundParams {
    return { ...this.soundParams[sound] };
  }

  trigger(sound: DrumSound): void {
    if (!this.ctx || !this.masterGain) return;
    const vol = this.trackVolumes.get(sound) ?? 0.8;
    if (vol <= 0) return;
    const p = this.soundParams[sound];

    switch (sound) {
      case 'kick': this.playKick(vol, p); break;
      case 'snare': this.playSnare(vol, p); break;
      case 'hihat-closed': this.playHiHat(vol, false, p); break;
      case 'hihat-open': this.playHiHat(vol, true, p); break;
      case 'clap': this.playClap(vol, p); break;
      case 'perc': this.playPerc(vol, p); break;
    }
  }

  // Soft clipping distortion via waveshaper
  private createDistortion(amount: number): WaveShaperNode {
    const ctx = this.ctx!;
    const ws = ctx.createWaveShaper();
    const k = amount * 4; // 0-400
    const samples = 256;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = k > 0 ? ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x)) : x;
    }
    ws.curve = curve;
    ws.oversample = '2x';
    return ws;
  }

  private playKick(vol: number, p: DrumSoundParams): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const pitch = p.param1; // 40-120
    const decay = p.param2; // 0.1-1.5
    const dist = p.param3; // 0-100

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(pitch * 14, now); // start high
    osc.frequency.exponentialRampToValueAtTime(pitch, now + 0.05);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    osc.connect(gain);

    if (dist > 0) {
      const ws = this.createDistortion(dist);
      gain.connect(ws);
      ws.connect(this.masterGain!);
      osc.addEventListener('ended', () => { try { osc.disconnect(); gain.disconnect(); ws.disconnect(); } catch {} });
    } else {
      gain.connect(this.masterGain!);
      osc.addEventListener('ended', () => { try { osc.disconnect(); gain.disconnect(); } catch {} });
    }
    osc.start(now);
    osc.stop(now + decay + 0.05);
  }

  private playSnare(vol: number, p: DrumSoundParams): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const pitch = p.param1; // 200-600
    const snap = p.param2 / 100; // 0-1
    const tone = p.param3 / 100; // 0-1 (0=all noise, 1=all tone)

    // Noise component
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const noiseGain = ctx.createGain();
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = pitch * 5;
    bandpass.Q.value = 1.5;
    const noiseVol = vol * 0.7 * (1 - tone * 0.7);
    noiseGain.gain.setValueAtTime(noiseVol * (0.5 + snap * 0.5), now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    noise.connect(bandpass);
    bandpass.connect(noiseGain);
    noiseGain.connect(this.masterGain!);
    noise.start(now);
    noise.stop(now + 0.2);

    // Tone body
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.5, now + 0.03);
    const toneVol = vol * 0.5 * (0.3 + tone * 0.7);
    oscGain.gain.setValueAtTime(toneVol * (0.5 + snap * 0.5), now);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.connect(oscGain);
    oscGain.connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.1);

    noise.addEventListener('ended', () => { try { noise.disconnect(); bandpass.disconnect(); noiseGain.disconnect(); } catch {} });
    osc.addEventListener('ended', () => { try { osc.disconnect(); oscGain.disconnect(); } catch {} });
  }

  private playHiHat(vol: number, open: boolean, p: DrumSoundParams): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const pitch = p.param1; // filter cutoff 6000-12000
    const decay = p.param2; // seconds
    const param3 = p.param3 / 100; // tight (0-1) or ring (0-1)

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const gain = ctx.createGain();
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = pitch;

    if (open) {
      // Ring = resonance
      hpf.Q.value = 1 + param3 * 10;
    } else {
      // Tight = faster cutoff
      hpf.Q.value = 1 + param3 * 3;
    }

    gain.gain.setValueAtTime(vol * 0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    noise.connect(hpf);
    hpf.connect(gain);
    gain.connect(this.masterGain!);
    noise.start(now);
    noise.stop(now + decay + 0.02);
    noise.addEventListener('ended', () => { try { noise.disconnect(); hpf.disconnect(); gain.disconnect(); } catch {} });
  }

  private playClap(vol: number, p: DrumSoundParams): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const pitch = p.param1; // 800-2400
    const decay = p.param2; // 0.05-0.3
    const room = p.param3 / 100; // 0-1

    // Create convolver for room if > 0
    let roomNode: ConvolverNode | null = null;
    let roomGain: GainNode | null = null;
    if (room > 0) {
      // Simple reverb via delay feedback
      roomGain = ctx.createGain();
      roomGain.gain.value = room * 0.4;
      roomGain.connect(this.masterGain!);
    }

    for (let i = 0; i < 3; i++) {
      const offset = i * 0.01;
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const gain = ctx.createGain();
      const bpf = ctx.createBiquadFilter();
      bpf.type = 'bandpass';
      bpf.frequency.value = pitch;
      bpf.Q.value = 2;
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(vol * 0.5, now + offset + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + decay);
      noise.connect(bpf);
      bpf.connect(gain);
      gain.connect(this.masterGain!);
      if (roomGain) gain.connect(roomGain);
      noise.start(now + offset);
      noise.stop(now + offset + decay + 0.05);
      noise.addEventListener('ended', () => { try { noise.disconnect(); bpf.disconnect(); gain.disconnect(); } catch {} });
    }

    // Cleanup room gain after sound finishes
    if (roomGain) {
      const rg = roomGain;
      setTimeout(() => { try { rg.disconnect(); } catch {} }, (decay + 0.5) * 1000);
    }
  }

  private playPerc(vol: number, p: DrumSoundParams): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const pitch = p.param1; // 200-2000
    const decay = p.param2; // 0.05-0.5
    const shape = p.param3 / 100; // 0=sine, 1=noise

    // Sine component
    if (shape < 1) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(pitch, now);
      osc.frequency.exponentialRampToValueAtTime(pitch * 0.4, now + decay * 0.3);
      const sineVol = vol * 0.6 * (1 - shape);
      gain.gain.setValueAtTime(sineVol, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now);
      osc.stop(now + decay + 0.05);
      osc.addEventListener('ended', () => { try { osc.disconnect(); gain.disconnect(); } catch {} });
    }

    // Noise component
    if (shape > 0) {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const noiseGain = ctx.createGain();
      const bpf = ctx.createBiquadFilter();
      bpf.type = 'bandpass';
      bpf.frequency.value = pitch;
      bpf.Q.value = 3;
      const noiseVol = vol * 0.5 * shape;
      noiseGain.gain.setValueAtTime(noiseVol, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      noise.connect(bpf);
      bpf.connect(noiseGain);
      noiseGain.connect(this.masterGain!);
      noise.start(now);
      noise.stop(now + decay + 0.05);
      noise.addEventListener('ended', () => { try { noise.disconnect(); bpf.disconnect(); noiseGain.disconnect(); } catch {} });
    }
  }
}