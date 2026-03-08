// Master sequencer engine — drives both drum machine and melody sequencer
import { DrumEngine, DrumSound, DRUM_SOUNDS } from './DrumEngine';

export interface DrumPattern {
  steps: boolean[][]; // [trackIndex][stepIndex]
  muted: boolean[];
}

export interface MelodyStep {
  active: boolean;
  note: number; // MIDI note
  velocity: number; // 0-127
}

export interface MelodyPattern {
  steps: MelodyStep[];
}

export interface SequencerState {
  playing: boolean;
  bpm: number;
  swing: number; // 0-50
  patternLength: 8 | 16 | 32;
  currentStep: number;
  drumPattern: DrumPattern;
  melodyPattern: MelodyPattern;
  melodySync: boolean;
  transpose: number; // -12 to +12
  gateLength: number; // 0.1 to 1.0
}

type NoteOnCallback = (note: number, velocity: number, duration: number) => void;
type NoteOffCallback = (note: number) => void;

export function createInitialDrumPattern(length: number): DrumPattern {
  return {
    steps: DRUM_SOUNDS.map(() => new Array(length).fill(false)),
    muted: DRUM_SOUNDS.map(() => false),
  };
}

export function createInitialMelodyPattern(length: number): MelodyPattern {
  return {
    steps: Array.from({ length }, () => ({
      active: false,
      note: 60, // C4
      velocity: 100,
    })),
  };
}

export class SequencerEngine {
  private drumEngine: DrumEngine;
  private ctx: AudioContext | null = null;
  private timerId: number | null = null;
  private nextStepTime = 0;
  private currentStep = 0;
  private playing = false;
  private bpm = 120;
  private swing = 0;
  private patternLength: 8 | 16 | 32 = 16;
  private drumPattern: DrumPattern;
  private melodyPattern: MelodyPattern;
  private melodySync = true;
  private transpose = 0;
  private gateLength = 0.5;
  private trackMuted: boolean[];

  private onStepChange: ((step: number) => void) | null = null;
  private onNoteOn: NoteOnCallback | null = null;
  private onNoteOff: NoteOffCallback | null = null;
  private activeMelodyNote: number | null = null;

  constructor() {
    this.drumEngine = new DrumEngine();
    this.drumPattern = createInitialDrumPattern(16);
    this.melodyPattern = createInitialMelodyPattern(16);
    this.trackMuted = DRUM_SOUNDS.map(() => false);
  }

  init(ctx: AudioContext): void {
    this.ctx = ctx;
    this.drumEngine.init(ctx, ctx.destination);
  }

  getDrumEngine(): DrumEngine { return this.drumEngine; }

  setOnStepChange(cb: (step: number) => void): void { this.onStepChange = cb; }
  setOnNoteOn(cb: NoteOnCallback): void { this.onNoteOn = cb; }
  setOnNoteOff(cb: NoteOffCallback): void { this.onNoteOff = cb; }

  setBpm(bpm: number): void { this.bpm = Math.max(60, Math.min(200, bpm)); }
  getBpm(): number { return this.bpm; }
  setSwing(swing: number): void { this.swing = Math.max(0, Math.min(50, swing)); }
  setPatternLength(len: 8 | 16 | 32): void { this.patternLength = len; }
  getPatternLength(): number { return this.patternLength; }
  setMelodySync(sync: boolean): void { this.melodySync = sync; }
  setTranspose(t: number): void { this.transpose = Math.max(-12, Math.min(12, t)); }
  setGateLength(g: number): void { this.gateLength = Math.max(0.1, Math.min(1, g)); }

  setDrumPattern(pattern: DrumPattern): void { this.drumPattern = pattern; }
  setMelodyPattern(pattern: MelodyPattern): void { this.melodyPattern = pattern; }
  setTrackMuted(trackIdx: number, muted: boolean): void {
    this.drumPattern.muted[trackIdx] = muted;
  }

  isPlaying(): boolean { return this.playing; }

  start(fromStep?: number): void {
    if (!this.ctx || this.playing) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.playing = true;
    if (fromStep !== undefined) {
      this.currentStep = fromStep;
    }
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this.schedule();
  }

  pause(): void {
    this.playing = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.activeMelodyNote !== null && this.onNoteOff) {
      this.onNoteOff(this.activeMelodyNote);
      this.activeMelodyNote = null;
    }
    // Do NOT reset currentStep
  }

  stop(): void {
    this.playing = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.activeMelodyNote !== null && this.onNoteOff) {
      this.onNoteOff(this.activeMelodyNote);
      this.activeMelodyNote = null;
    }
    this.currentStep = 0;
    this.onStepChange?.(0);
  }

  getCurrentStep(): number { return this.currentStep; }

  private schedule(): void {
    if (!this.ctx || !this.playing) return;

    const lookahead = 0.1; // seconds
    while (this.nextStepTime < this.ctx.currentTime + lookahead) {
      this.playStep(this.currentStep, this.nextStepTime);
      this.advanceStep();
    }

    this.timerId = window.setTimeout(() => this.schedule(), 25);
  }

  private getStepDuration(): number {
    return 60 / this.bpm / 4; // 16th note
  }

  private advanceStep(): void {
    const stepDuration = this.getStepDuration();
    const isOddStep = this.currentStep % 2 === 1;
    const swingOffset = isOddStep ? (this.swing / 100) * stepDuration : 0;

    this.nextStepTime += stepDuration + swingOffset;
    this.currentStep = (this.currentStep + 1) % this.patternLength;
  }

  private playStep(step: number, time: number): void {
    this.onStepChange?.(step);

    // Drums
    DRUM_SOUNDS.forEach((sound, trackIdx) => {
      if (
        this.drumPattern.steps[trackIdx]?.[step] &&
        !this.drumPattern.muted[trackIdx]
      ) {
        this.drumEngine.trigger(sound.id);
      }
    });

    // Melody
    if (this.melodySync) {
      const melodyStep = this.melodyPattern.steps[step % this.melodyPattern.steps.length];
      if (melodyStep?.active) {
        const note = melodyStep.note + this.transpose;
        const velocity = melodyStep.velocity;
        const duration = this.getStepDuration() * this.gateLength;

        // Release previous
        if (this.activeMelodyNote !== null && this.onNoteOff) {
          this.onNoteOff(this.activeMelodyNote);
        }

        this.activeMelodyNote = note;
        this.onNoteOn?.(note, velocity, duration);

        // Schedule note off
        setTimeout(() => {
          if (this.activeMelodyNote === note && this.onNoteOff) {
            this.onNoteOff(note);
            this.activeMelodyNote = null;
          }
        }, duration * 1000);
      }
    }
  }

  clearAll(): void {
    this.drumPattern = createInitialDrumPattern(this.patternLength);
    this.melodyPattern = createInitialMelodyPattern(this.patternLength);
  }
}
