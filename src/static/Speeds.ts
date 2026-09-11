import { gameState } from '../game-state';

// ── Speed Table (Phase 6) ─────────────────────────────────────────────────────
// All values are fractions of max speed (1.0 = 100%).
//
// Pure functions of the level, so an online client can work out the same
// numbers the host is using from what a snapshot already carries.

export function getPlayerNormalSpeed(level: number): number {
    if (level === 1) return 0.80;
    if (level <= 4)  return 0.90;
    if (level <= 20) return 1.00;
    return 0.90; // level 21+
}

export function getPlayerFrightSpeed(level: number): number {
    if (level === 1) return 0.90;
    if (level <= 4)  return 0.95;
    if (level <= 20) return 1.00;
    return 0.90; // level 21+ — no boost (same as normal)
}

export function getEnemyNormalSpeed(level: number): number {
    if (level === 1) return 0.75;
    if (level <= 4)  return 0.85;
    return 0.95; // level 5+
}

export function getEnemyFrightSpeed(level: number): number {
    if (level === 1) return 0.50;
    if (level <= 4)  return 0.55;
    return 0.60; // level 5+
}

export function getEnemyTunnelSpeed(level: number): number {
    if (level === 1) return 0.40;
    if (level <= 4)  return 0.45;
    return 0.50; // level 5+
}

export function getCurrentPlayerSpeed(): number {
    const anyFrightened = gameState.enemies.some(g => g.enemyMode === 'frightened');
    return anyFrightened
        ? getPlayerFrightSpeed(gameState.level)
        : getPlayerNormalSpeed(gameState.level);
}
