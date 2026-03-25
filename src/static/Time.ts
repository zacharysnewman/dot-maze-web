import { Timer } from '../object/Timer';

export class Time {
    static startTime = 0;
    static timeSinceStart = 0;
    static deltaTime = 0;
    static scaledDeltaTime = 0;
    static frameCount = 0;
    static timers: Timer[] = [];

    static setup(): void {
        Time.startTime = new Date().getTime();
        Time.timeSinceStart = new Date().getTime() - Time.startTime;
    }

    static update(): void {
        Time.frameCount++;

        const prevTimeSinceStart = Time.timeSinceStart;
        Time.timeSinceStart = (new Date().getTime() - Time.startTime) / 1000;
        Time.deltaTime = Time.timeSinceStart - prevTimeSinceStart;
        Time.scaledDeltaTime = Time.deltaTime * 60;

        Time.timers.forEach(timer => {
            if (Time.timeSinceStart >= timer.end) {
                timer.callback();
            }
        });
        Time.timers = Time.timers.filter(timer => Time.timeSinceStart < timer.end);
    }

    static reset(): void {
        Time.startTime = new Date().getTime();
        Time.timeSinceStart = 0;
        Time.deltaTime = 0;
        Time.scaledDeltaTime = 0;
        Time.frameCount = 0;
    }

    // Accepts duration in seconds; Timer stores the absolute end time to avoid
    // a circular dependency between Timer and Time.
    static addTimer(duration: number, callback: () => void): void {
        Time.timers.push(new Timer(Time.timeSinceStart + duration, callback));
    }
}
