import { tileIndex } from './Protocol';
import type { NetEvent } from './Protocol';

/**
 * What the host did this frame that a client cannot work out for itself.
 *
 * Sound is triggered inline inside game logic — `Sound.dot()` fires from the
 * tile callback, `Sound.death()` from `loseLife` — and clients never run that
 * logic. Eaten tiles are the same problem: the client holds its own copy of the
 * dot grid and has no way to know which tiles went.
 *
 * The host records both here as they happen, and the next snapshot carries and
 * clears them. Recording is off unless a host is running, so local play never
 * fills a buffer nothing drains.
 */
export class NetEvents {
    private static events: NetEvent[] = [];
    private static eatenTiles: number[] = [];
    /** Off for local play, where nothing would ever drain these. */
    private static recording = false;

    static setRecording(recording: boolean): void {
        NetEvents.recording = recording;
        if (!recording) NetEvents.clear();
    }

    static record(event: NetEvent): void {
        if (NetEvents.recording) NetEvents.events.push(event);
    }

    static recordEaten(x: number, y: number): void {
        if (NetEvents.recording) NetEvents.eatenTiles.push(tileIndex(x, y));
    }

    static drain(): { events: NetEvent[]; eaten: number[] } {
        const drained = { events: NetEvents.events, eaten: NetEvents.eatenTiles };
        NetEvents.events = [];
        NetEvents.eatenTiles = [];
        return drained;
    }

    static clear(): void {
        NetEvents.events = [];
        NetEvents.eatenTiles = [];
    }
}
