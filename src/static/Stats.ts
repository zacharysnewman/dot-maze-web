export class Stats {
    static lives = 3;
    static currentScore = 0;
    static highScore = 10000;
    static extraLifeAwarded = false;

    static addToScore(points: number): void {
        const wasBelow10k = Stats.currentScore < 10000;
        Stats.currentScore += points;
        if (Stats.currentScore > Stats.highScore) {
            Stats.highScore = Stats.currentScore;
        }
        if (wasBelow10k && Stats.currentScore >= 10000 && !Stats.extraLifeAwarded) {
            Stats.extraLifeAwarded = true;
            Stats.lives++;
        }
    }

    static reset(): void {
        Stats.lives = 3;
        Stats.currentScore = 0;
        Stats.extraLifeAwarded = false;
    }
}
