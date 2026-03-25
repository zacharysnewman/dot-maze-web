export class Timer {
    end: number;
    callback: () => void;

    constructor(endTime: number, callback: () => void) {
        this.end = endTime;
        this.callback = callback;
    }
}
