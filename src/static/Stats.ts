export class Stats {
    static lives = 3;
    static currentScore = 0;
    static highScore = 10000;

    static addToScore(points: number): void {
        Stats.currentScore += points;
        if (Stats.currentScore > Stats.highScore) {
            Stats.highScore = Stats.currentScore;
        }
    }

    static reset(): void {
        Stats.lives = 3;
        Stats.currentScore = 0;
    }
}
