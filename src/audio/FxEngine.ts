// FX Pad sound engine — all sounds synthesized with Web Audio API

export interface FxSound {
  id: string;
  label: string;
  emoji: string;
}

export interface FxCategory {
  name: string;
  icon: string;
  sounds: FxSound[];
}

export const FX_CATEGORIES: FxCategory[] = [
  {
    name: 'CLASSIC FX', icon: '⚡',
    sounds: [
      { id: 'laser', label: 'LASER', emoji: '🚀' },
      { id: 'boom', label: 'BOOM', emoji: '💥' },
      { id: 'zap', label: 'ZAP', emoji: '⚡' },
      { id: 'ding', label: 'DING', emoji: '🔔' },
      { id: 'blip', label: 'BLIP', emoji: '📯' },
      { id: 'fanfare', label: 'FANFARE', emoji: '🎺' },
    ],
  },
  {
    name: 'SCI-FI / GAME', icon: '👾',
    sounds: [
      { id: 'coin', label: 'COIN', emoji: '👾' },
      { id: 'phaser', label: 'PHASER', emoji: '🛸' },
      { id: 'powerup', label: 'POWERUP', emoji: '💫' },
      { id: 'gameover', label: 'GAMEOVER', emoji: '💀' },
      { id: 'warp', label: 'WARP', emoji: '🌀' },
      { id: 'robot', label: 'ROBOT', emoji: '🤖' },
    ],
  },
  {
    name: 'DJ / SCRATCH', icon: '🎧',
    sounds: [
      { id: 'scratch1', label: 'SCRATCH1', emoji: '🎧' },
      { id: 'scratch2', label: 'SCRATCH2', emoji: '🎧' },
      { id: 'rewind', label: 'REWIND', emoji: '🔄' },
      { id: 'stutter', label: 'STUTTER', emoji: '📻' },
      { id: 'airhorn', label: 'AIRHORN', emoji: '🔊' },
      { id: 'whoosh', label: 'WHOOSH', emoji: '🎵' },
    ],
  },
  {
    name: 'FUN / CARTOON', icon: '🎉',
    sounds: [
      { id: 'boing', label: 'BOING', emoji: '🎉' },
      { id: 'swoosh', label: 'SWOOSH', emoji: '💨' },
      { id: 'tweet', label: 'TWEET', emoji: '🐦' },
      { id: 'beep', label: 'BEEP', emoji: '🚗' },
      { id: 'quack', label: 'QUACK', emoji: '😂' },
      { id: 'tada', label: 'TADA', emoji: '🎊' },
    ],
  },
];

// Backward compat
export const FX_SOUNDS: FxSound[][] = FX_CATEGORIES.map(c => c.sounds);

export class FxEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private fxGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private activeNodes: Map<string, { stop: () => void }> = new Map();

  init(ctx: AudioContext, destination: AudioNode, recordingDest?: AudioNode | null): void {
    this.ctx = ctx;
    this.fxGain = ctx.createGain();
    this.fxGain.gain.value = 0.7;
    this.fxGain.connect(destination);
    if (recordingDest) {
      this.fxGain.connect(recordingDest);
    }
    this.noiseBuffer = this.createNoiseBuffer();
  }

  private createNoiseBuffer(): AudioBuffer {
    const ctx = this.ctx!;
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  setVolume(v: number): void {
    if (this.fxGain) this.fxGain.gain.value = v;
  }

  getVolume(): number {
    return this.fxGain?.gain.value ?? 0.7;
  }

  trigger(id: string): void {
    if (!this.ctx || !this.fxGain) return;
    // Stop existing instance of same sound
    this.stop(id);
    
    const ctx = this.ctx;
    const dest = this.fxGain;
    const now = ctx.currentTime;

    switch (id) {
      case 'laser': this.playLaser(ctx, dest, now); break;
      case 'boom': this.playBoom(ctx, dest, now); break;
      case 'zap': this.playZap(ctx, dest, now); break;
      case 'ding': this.playDing(ctx, dest, now); break;
      case 'blip': this.playBlip(ctx, dest, now); break;
      case 'fanfare': this.playFanfare(ctx, dest, now); break;
      case 'coin': this.playCoin(ctx, dest, now); break;
      case 'phaser': this.playPhaser(ctx, dest, now); break;
      case 'powerup': this.playPowerup(ctx, dest, now); break;
      case 'gameover': this.playGameover(ctx, dest, now); break;
      case 'warp': this.playWarp(ctx, dest, now); break;
      case 'robot': this.playRobot(ctx, dest, now); break;
      case 'scratch1': this.playScratch(ctx, dest, now, 0.3); break;
      case 'scratch2': this.playScratch(ctx, dest, now, 0.6); break;
      case 'rewind': this.playRewind(ctx, dest, now); break;
      case 'stutter': this.playStutter(ctx, dest, now); break;
      case 'airhorn': this.playAirhorn(ctx, dest, now); break;
      case 'whoosh': this.playWhoosh(ctx, dest, now); break;
      case 'boing': this.playBoing(ctx, dest, now); break;
      case 'swoosh': this.playSwoosh(ctx, dest, now); break;
      case 'tweet': this.playTweet(ctx, dest, now); break;
      case 'beep': this.playBeep(ctx, dest, now); break;
      case 'quack': this.playQuack(ctx, dest, now); break;
      case 'tada': this.playTada(ctx, dest, now); break;
    }
  }

  stop(id: string): void {
    const node = this.activeNodes.get(id);
    if (node) {
      node.stop();
      this.activeNodes.delete(id);
    }
  }

  private track(id: string, nodes: AudioNode[], oscs: OscillatorNode[] = [], srcs: AudioBufferSourceNode[] = [], duration: number): void {
    const timeout = setTimeout(() => {
      this.activeNodes.delete(id);
      for (const n of nodes) try { n.disconnect(); } catch {}
    }, duration * 1000 + 100);
    
    this.activeNodes.set(id, {
      stop: () => {
        clearTimeout(timeout);
        for (const o of oscs) try { o.stop(); } catch {}
        for (const s of srcs) try { s.stop(); } catch {}
        for (const n of nodes) try { n.disconnect(); } catch {}
      }
    });
  }

  // ROW 1
  private playLaser(ctx: AudioContext, dest: AudioNode, now: number): void {
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.3);
    g.gain.setValueAtTime(0.5, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(g); g.connect(dest);
    osc.start(now); osc.stop(now + 0.35);
    this.track('laser', [osc, g], [osc], [], 0.35);
  }

  private playBoom(ctx: AudioContext, dest: AudioNode, now: number): void {
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    const ws = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i * 2) / 256 - 1; curve[i] = (Math.PI * x) / (Math.PI + 4 * Math.abs(x)); }
    ws.curve = curve;
    osc.type = 'sine'; osc.frequency.setValueAtTime(80, now);
    g.gain.setValueAtTime(0.8, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    osc.connect(ws); ws.connect(g); g.connect(dest);
    osc.start(now); osc.stop(now + 0.45);
    this.track('boom', [osc, ws, g], [osc], [], 0.45);
  }

  private playZap(ctx: AudioContext, dest: AudioNode, now: number): void {
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(2000, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.2);
    g.gain.setValueAtTime(0.4, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.connect(g); g.connect(dest);
    osc.start(now); osc.stop(now + 0.25);
    this.track('zap', [osc, g], [osc], [], 0.25);
  }

  private playDing(ctx: AudioContext, dest: AudioNode, now: number): void {
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = 880;
    g.gain.setValueAtTime(0.5, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 2);
    osc.connect(g); g.connect(dest);
    osc.start(now); osc.stop(now + 2.1);
    this.track('ding', [osc, g], [osc], [], 2.1);
  }

  private playBlip(ctx: AudioContext, dest: AudioNode, now: number): void {
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.type = 'square'; osc.frequency.value = 1000;
    g.gain.setValueAtTime(0.4, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    osc.connect(g); g.connect(dest);
    osc.start(now); osc.stop(now + 0.1);
    this.track('blip', [osc, g], [osc], [], 0.1);
  }

  private playFanfare(ctx: AudioContext, dest: AudioNode, now: number): void {
    const notes = [261.6, 329.6, 392, 523.25]; // C4 E4 G4 C5
    const allNodes: AudioNode[] = [];
    const allOscs: OscillatorNode[] = [];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.type = 'sawtooth'; osc.frequency.value = freq;
      const t = now + i * 0.1;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.3, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      osc.connect(g); g.connect(dest);
      osc.start(t); osc.stop(t + 0.2);
      allNodes.push(osc, g); allOscs.push(osc);
    });
    this.track('fanfare', allNodes, allOscs, [], 0.6);
  }

  // ROW 2
  private playCoin(ctx: AudioContext, dest: AudioNode, now: number): void {
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(523, now);
    osc.frequency.setValueAtTime(1046, now + 0.05);
    g.gain.setValueAtTime(0.3, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    osc.connect(g); g.connect(dest);
    osc.start(now); osc.stop(now + 0.15);
    this.track('coin', [osc, g], [osc], [], 0.15);
  }

  private playPhaser(ctx: AudioContext, dest: AudioNode, now: number): void {
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer;
    const g = ctx.createGain(); const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.Q.value = 5;
    bpf.frequency.setValueAtTime(200, now);
    bpf.frequency.exponentialRampToValueAtTime(4000, now + 0.25);
    bpf.frequency.exponentialRampToValueAtTime(200, now + 0.5);
    g.gain.setValueAtTime(0.5, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    noise.connect(bpf); bpf.connect(g); g.connect(dest);
    noise.start(now); noise.stop(now + 0.55);
    this.track('phaser', [noise, bpf, g], [], [noise], 0.55);
  }

  private playPowerup(ctx: AudioContext, dest: AudioNode, now: number): void {
    const allNodes: AudioNode[] = []; const allOscs: OscillatorNode[] = [];
    for (let i = 0; i < 24; i++) {
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      const freq = 261.6 * Math.pow(2, i / 12); // chromatic from C4
      const t = now + i * (0.4 / 24);
      osc.type = 'square'; osc.frequency.value = freq;
      g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      osc.connect(g); g.connect(dest);
      osc.start(t); osc.stop(t + 0.06);
      allNodes.push(osc, g); allOscs.push(osc);
    }
    this.track('powerup', allNodes, allOscs, [], 0.5);
  }

  private playGameover(ctx: AudioContext, dest: AudioNode, now: number): void {
    const notes = [392, 349.2, 329.6, 293.7, 261.6]; // G4 F4 E4 D4 C4
    const allNodes: AudioNode[] = []; const allOscs: OscillatorNode[] = [];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.type = 'sawtooth'; osc.frequency.value = freq;
      const t = now + i * 0.2;
      g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      osc.connect(g); g.connect(dest);
      osc.start(t); osc.stop(t + 0.3);
      allNodes.push(osc, g); allOscs.push(osc);
    });
    this.track('gameover', allNodes, allOscs, [], 1.2);
  }

  private playWarp(ctx: AudioContext, dest: AudioNode, now: number): void {
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2000, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.8);
    g.gain.setValueAtTime(0.4, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    osc.connect(g); g.connect(dest);
    osc.start(now); osc.stop(now + 0.85);
    this.track('warp', [osc, g], [osc], [], 0.85);
  }

  private playRobot(ctx: AudioContext, dest: AudioNode, now: number): void {
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    const lfo = ctx.createOscillator(); const lfoGain = ctx.createGain();
    osc.type = 'square'; osc.frequency.value = 200;
    lfo.frequency.value = 15; lfoGain.gain.value = 50;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    g.gain.setValueAtTime(0.4, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    osc.connect(g); g.connect(dest);
    osc.start(now); lfo.start(now);
    osc.stop(now + 0.55); lfo.stop(now + 0.55);
    this.track('robot', [osc, g, lfo, lfoGain], [osc, lfo], [], 0.55);
  }

  // ROW 3
  private playScratch(ctx: AudioContext, dest: AudioNode, now: number, dur: number): void {
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer;
    const g = ctx.createGain(); const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.Q.value = 3;
    // Wobble pitch
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const t = now + (i / steps) * dur;
      const freq = i % 2 === 0 ? 1000 + Math.random() * 2000 : 300 + Math.random() * 500;
      bpf.frequency.setValueAtTime(freq, t);
    }
    g.gain.setValueAtTime(0.5, now);
    g.gain.setValueAtTime(0.5, now + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    noise.connect(bpf); bpf.connect(g); g.connect(dest);
    noise.start(now); noise.stop(now + dur + 0.05);
    const id = dur > 0.4 ? 'scratch2' : 'scratch1';
    this.track(id, [noise, bpf, g], [], [noise], dur + 0.05);
  }

  private playRewind(ctx: AudioContext, dest: AudioNode, now: number): void {
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer;
    const g = ctx.createGain(); const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.Q.value = 2;
    bpf.frequency.setValueAtTime(3000, now);
    bpf.frequency.exponentialRampToValueAtTime(200, now + 0.6);
    g.gain.setValueAtTime(0.4, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    noise.connect(bpf); bpf.connect(g); g.connect(dest);
    noise.start(now); noise.stop(now + 0.65);
    this.track('rewind', [noise, bpf, g], [], [noise], 0.65);
  }

  private playStutter(ctx: AudioContext, dest: AudioNode, now: number): void {
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer;
    const g = ctx.createGain();
    const tremolo = ctx.createGain();
    const lfo = ctx.createOscillator();
    lfo.type = 'square'; lfo.frequency.value = 20;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.5;
    lfo.connect(lfoG); lfoG.connect(tremolo.gain);
    tremolo.gain.setValueAtTime(0.5, now);
    g.gain.setValueAtTime(0.4, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    noise.connect(tremolo); tremolo.connect(g); g.connect(dest);
    lfo.start(now); noise.start(now);
    lfo.stop(now + 0.35); noise.stop(now + 0.35);
    this.track('stutter', [noise, g, tremolo, lfo, lfoG], [lfo], [noise], 0.35);
  }

  private playAirhorn(ctx: AudioContext, dest: AudioNode, now: number): void {
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.linearRampToValueAtTime(210, now + 0.5);
    g.gain.setValueAtTime(0.6, now); g.gain.setValueAtTime(0.6, now + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    osc.connect(g); g.connect(dest);
    osc.start(now); osc.stop(now + 0.55);
    this.track('airhorn', [osc, g], [osc], [], 0.55);
  }

  private playWhoosh(ctx: AudioContext, dest: AudioNode, now: number): void {
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer;
    const g = ctx.createGain(); const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.Q.value = 2;
    bpf.frequency.setValueAtTime(6000, now);
    bpf.frequency.exponentialRampToValueAtTime(200, now + 0.4);
    g.gain.setValueAtTime(0.4, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    noise.connect(bpf); bpf.connect(g); g.connect(dest);
    noise.start(now); noise.stop(now + 0.45);
    this.track('whoosh', [noise, bpf, g], [], [noise], 0.45);
  }

  // ROW 4
  private playBoing(ctx: AudioContext, dest: AudioNode, now: number): void {
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.linearRampToValueAtTime(600, now + 0.15);
    osc.frequency.linearRampToValueAtTime(300, now + 0.3);
    osc.frequency.linearRampToValueAtTime(500, now + 0.35);
    osc.frequency.linearRampToValueAtTime(300, now + 0.4);
    g.gain.setValueAtTime(0.4, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    osc.connect(g); g.connect(dest);
    osc.start(now); osc.stop(now + 0.45);
    this.track('boing', [osc, g], [osc], [], 0.45);
  }

  private playSwoosh(ctx: AudioContext, dest: AudioNode, now: number): void {
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer;
    const g = ctx.createGain(); const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = 3000;
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.4, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    noise.connect(hpf); hpf.connect(g); g.connect(dest);
    noise.start(now); noise.stop(now + 0.35);
    this.track('swoosh', [noise, hpf, g], [], [noise], 0.35);
  }

  private playTweet(ctx: AudioContext, dest: AudioNode, now: number): void {
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    const lfo = ctx.createOscillator(); const lfoG = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = 1200;
    lfo.type = 'sine'; lfo.frequency.value = 30; lfoG.gain.value = 200;
    lfo.connect(lfoG); lfoG.connect(osc.frequency);
    g.gain.setValueAtTime(0.3, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.connect(g); g.connect(dest);
    osc.start(now); lfo.start(now);
    osc.stop(now + 0.25); lfo.stop(now + 0.25);
    this.track('tweet', [osc, g, lfo, lfoG], [osc, lfo], [], 0.25);
  }

  private playBeep(ctx: AudioContext, dest: AudioNode, now: number): void {
    const osc1 = ctx.createOscillator(); const osc2 = ctx.createOscillator();
    const g = ctx.createGain();
    osc1.type = 'sine'; osc1.frequency.value = 440;
    osc2.type = 'sine'; osc2.frequency.value = 480;
    g.gain.setValueAtTime(0.3, now); g.gain.setValueAtTime(0.3, now + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    osc1.connect(g); osc2.connect(g); g.connect(dest);
    osc1.start(now); osc2.start(now);
    osc1.stop(now + 0.45); osc2.stop(now + 0.45);
    this.track('beep', [osc1, osc2, g], [osc1, osc2], [], 0.45);
  }

  private playQuack(ctx: AudioContext, dest: AudioNode, now: number): void {
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer;
    const g = ctx.createGain(); const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = 800; bpf.Q.value = 5;
    const tremolo = ctx.createGain();
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 8;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.3;
    lfo.connect(lfoG); lfoG.connect(tremolo.gain); tremolo.gain.setValueAtTime(0.5, now);
    g.gain.setValueAtTime(0.4, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    noise.connect(bpf); bpf.connect(tremolo); tremolo.connect(g); g.connect(dest);
    lfo.start(now); noise.start(now);
    lfo.stop(now + 0.25); noise.stop(now + 0.25);
    this.track('quack', [noise, bpf, tremolo, g, lfo, lfoG], [lfo], [noise], 0.25);
  }

  private playTada(ctx: AudioContext, dest: AudioNode, now: number): void {
    const notes = [261.6, 329.6, 392]; // C E G
    const allNodes: AudioNode[] = []; const allOscs: OscillatorNode[] = [];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.type = 'sawtooth'; osc.frequency.value = freq;
      const t = now + i * 0.03;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 3000;
      osc.connect(lpf); lpf.connect(g); g.connect(dest);
      osc.start(t); osc.stop(t + 0.55);
      allNodes.push(osc, g, lpf); allOscs.push(osc);
    });
    this.track('tada', allNodes, allOscs, [], 0.6);
  }
}