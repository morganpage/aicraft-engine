import type { AudioAdapter } from '../audio';
import { noteToFrequency } from './theory';
import type { NoteFire, NoteFirePlayer } from './types';

/** Map externally advanced note events onto an existing defensive audio host. */
export function createNoteFirePlayer(audio: AudioAdapter): NoteFirePlayer {
  let volume = 1;
  let disposed = false;

  return {
    play(events: readonly NoteFire[]): void {
      if (disposed || !Array.isArray(events)) return;
      try {
        for (const event of events) {
          try {
            if (!event || !Number.isFinite(event.midi)) continue;
            const frequency = noteToFrequency(event.midi);
            if (!Number.isFinite(frequency) || frequency <= 0) continue;
            const gateS = Number.isFinite(event.gateS) ? Math.max(0, event.gateS) : 0;
            const rawDurationMs = gateS * 1000;
            const durationMs = Number.isFinite(rawDurationMs) ? rawDurationMs : 0;
            const peak = Number.isFinite(event.peak) ? Math.max(0, event.peak) : 0;
            const whenOffset = Number.isFinite(event.whenOffset)
              ? Math.max(0, event.whenOffset)
              : 0;
            audio.playTone(
              event.waveform,
              frequency,
              frequency,
              durationMs,
              peak * volume,
              whenOffset,
            );
          } catch {
            // One malformed event or failed host call must not stop later notes.
          }
        }
      } catch {
        // Hostile array iterators are malformed input and remain decorative.
      }
    },
    setVolume(value: number): void {
      volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    },
    getVolume(): number {
      return volume;
    },
    dispose(): void {
      disposed = true;
    },
  };
}
