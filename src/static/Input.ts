import { gameState } from '../game-state';

export class Input {
    static leftPressed = false;
    static rightPressed = false;
    static upPressed = false;
    static downPressed = false;

    static checkKeyDown(e: KeyboardEvent): void {
        switch (e.keyCode) {
            case 37: Input.leftPressed = true; break;
            case 38: Input.upPressed = true; break;
            case 39: Input.rightPressed = true; break;
            case 40: Input.downPressed = true; break;
        }
    }

    static checkKeyUp(e: KeyboardEvent): void {
        switch (e.keyCode) {
            case 37: Input.leftPressed = false; break;
            case 38: Input.upPressed = false; break;
            case 39: Input.rightPressed = false; break;
            case 40: Input.downPressed = false; break;
        }
    }

    static update(): void {
        const pacman = gameState.pacman;
        if (Input.leftPressed && (pacman.leftObject() ?? 0) > 2 && pacman.moveDir !== 'left') {
            pacman.moveDir = 'left';
        }
        if (Input.upPressed && (pacman.topObject() ?? 0) > 2 && pacman.moveDir !== 'up') {
            pacman.moveDir = 'up';
        }
        if (Input.rightPressed && (pacman.rightObject() ?? 0) > 2 && pacman.moveDir !== 'right') {
            pacman.moveDir = 'right';
        }
        if (Input.downPressed && (pacman.bottomObject() ?? 0) > 2 && pacman.moveDir !== 'down') {
            pacman.moveDir = 'down';
        }
    }
}
