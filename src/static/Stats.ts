const LS_KEY = 'pacman-scores';

export interface HighScoreEntry {
    initials: string;
    score: number;
}

const DEFAULT_SCORES: HighScoreEntry[] = [
    { initials: 'ACE', score: 10000 },
    { initials: 'PRO', score:  9000 },
    { initials: 'PAC', score:  8000 },
    { initials: 'GHO', score:  7000 },
    { initials: 'INK', score:  6000 },
    { initials: 'PIN', score:  5000 },
    { initials: 'BLK', score:  4000 },
    { initials: 'CLY', score:  3000 },
    { initials: 'DOT', score:  2000 },
    { initials: 'PWR', score:  1000 },
];

export class Stats {
    static lives = 3;
    static currentScore = 0;
    static highScore = Stats.loadBestScore();
    static extraLifeAwarded = false;

    private static loadBestScore(): number {
        const scores = Stats.loadHighScores();
        return scores.length > 0 ? scores[0].score : 0;
    }

    static loadHighScores(): HighScoreEntry[] {
        try {
            const data = localStorage.getItem(LS_KEY);
            if (!data) return [...DEFAULT_SCORES];
            const parsed = JSON.parse(data);
            // Migrate from old format (plain number[]) — no initials, clear and use defaults
            if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] !== 'object') {
                localStorage.removeItem(LS_KEY);
                return [...DEFAULT_SCORES];
            }
            return parsed as HighScoreEntry[];
        } catch { return [...DEFAULT_SCORES]; }
    }

    static qualifiesForTopTen(score: number): boolean {
        if (score <= 0) return false;
        const scores = Stats.loadHighScores();
        return scores.length < 10 || score > scores[scores.length - 1].score;
    }

    static saveScore(initials: string, score: number): void {
        if (score <= 0) return;
        const scores = Stats.loadHighScores();
        scores.push({ initials: initials.toUpperCase().padEnd(3, 'A').slice(0, 3), score });
        scores.sort((a, b) => b.score - a.score);
        const top10 = scores.slice(0, 10);
        localStorage.setItem(LS_KEY, JSON.stringify(top10));
        Stats.highScore = top10[0].score;
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
