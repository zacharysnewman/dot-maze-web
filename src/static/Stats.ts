const LS_KEY = 'pacman-scores';

export class Stats {
    static lives = 3;
    static currentScore = 0;
    static highScore = Stats.loadBestScore();
    static extraLifeAwarded = false;

    private static loadBestScore(): number {
        try {
            const scores: number[] = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
            return scores.length > 0 ? scores[0] : 0;
        } catch { return 0; }
    }

    static loadHighScores(): number[] {
        try {
            return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
        } catch { return []; }
    }

    static saveScore(score: number): void {
        if (score <= 0) return;
        const scores = Stats.loadHighScores();
        scores.push(score);
        scores.sort((a, b) => b - a);
        localStorage.setItem(LS_KEY, JSON.stringify(scores.slice(0, 10)));
        Stats.highScore = scores[0];
    }

    static addToScore(points: number): void {
        const wasBelow10k = Stats.currentScore < 10000;
        Stats.currentScore += points;
        if (Stats.currentScore > Stats.highScore) Stats.highScore = Stats.currentScore;
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
