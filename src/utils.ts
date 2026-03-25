export function lerp(start: number, end: number, factor: number): number {
    return start * (1 - factor) + end * factor;
}

export function getDistance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}
