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

export class DrumEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private trackVolumes: Map<DrumSound, number> = new Map();
  private noiseBuffer: AudioBuffer | null = null;

  constructor() {
    DRUM_SOUNDS.forEach(s => this.trackVolumes.set(s.id, 0.8));
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

  trigger(sound: DrumSound): void {
    if (!this.ctx || !this.masterGain) return;
    const vol = this.trackVolumes.get(sound) ?? 0.8;
    if (vol <= 0) return;

    switch (sound) {
      case 'kick': this.playKick(vol); break;
      case 'snare': this.playSnare(vol); break;
      case 'hihat-closed': this.playHiHat(vol, false); break;
      case 'hihat-open': this.playHiHat(vol, true); break;
      case 'clap': this.playClap(vol); break;
      case 'perc': this.playPerc(vol); break;
    }
  }

  private playKick(vol: number): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.05);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.45);
    osc.addEventListener('ended', () => { try { osc.disconnect(); gain.disconnect(); } catch {} });
  }

  private playSnare(vol: number): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    // Noise component
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const noiseGain = ctx.createGain();
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 3000;
    bandpass.Q.value = 1.5;
    noiseGain.gain.setValueAtTime(vol * 0.7, now);
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
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.03);
    oscGain.gain.setValueAtTime(vol * 0.5, now);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.connect(oscGain);
    oscGain.connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.1);

    noise.addEventListener('ended', () => { try { noise.disconnect(); bandpass.disconnect(); noiseGain.disconnect(); } catch {} });
    osc.addEventListener('ended', () => { try { osc.disconnect(); oscGain.disconnect(); } catch {} });
  }

  private playHiHat(vol: number, open: boolean): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const decay = open ? 0.3 : 0.05;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const gain = ctx.createGain();
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 7000;
    gain.gain.setValueAtTime(vol * 0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    noise.connect(hpf);
    hpf.connect(gain);
    gain.connect(this.masterGain!);
    noise.start(now);
    noise.stop(now + decay + 0.02);
    noise.addEventListener('ended', () => { try { noise.disconnect(); hpf.disconnect(); gain.disconnect(); } catch {} });
  }

  private playClap(vol: number): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    for (let i = 0; i < 3; i++) {
      const offset = i * 0.01;
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const gain = ctx.createGain();
      const bpf = ctx.createBiquadFilter();
      bpf.type = 'bandpass';
      bpf.frequency.value = 2500;
      bpf.Q.value = 2;
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(vol * 0.5, now + offset + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.12);
      noise.connect(bpf);
      bpf.connect(gain);
      gain.connect(this.masterGain!);
      noise.start(now + offset);
      noise.stop(now + offset + 0.15);
      noise.addEventListener('ended', () => { try { noise.disconnect(); bpf.disconnect(); gain.disconnect(); } catch {} });
    }
  }

  private playPerc(vol: number): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.05);
    gain.gain.setValueAtTime(vol * 0.6, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.2);
    osc.addEventListener('ended', () => { try { osc.disconnect(); gain.disconnect(); } catch {} });
  }
}
