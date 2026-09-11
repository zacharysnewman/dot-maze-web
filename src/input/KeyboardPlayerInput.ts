import type { PlayerInput } from './PlayerInput';
import { applyPlayerInput, bufferDir } from './PlayerInput';
import type { Direction, IGameObject } from '../types';

export class KeyboardPlayerInput implements PlayerInput {
    leftPressed  = false;
    rightPressed = false;
    upPressed    = false;
    downPressed  = false;
    bufferedDir: Direction | null = null;
    bufferedDirFramesLeft = 0;

    private readonly onKeyDown: (e: KeyboardEvent) => void;
    private readonly onKeyUp:   (e: KeyboardEvent) => void;

    constructor() {
        this.onKeyDown = (e: KeyboardEvent) => {
            switch (e.key) {
                case 'ArrowLeft':  this.leftPressed  = true; bufferDir(this, 'left');  break;
                case 'ArrowUp':    this.upPressed    = true; bufferDir(this, 'up');    break;
                case 'ArrowRight': this.rightPressed = true; bufferDir(this, 'right'); break;
                case 'ArrowDown':  this.downPressed  = true; bufferDir(this, 'down');  break;
            }
        };
        this.onKeyUp = (e: KeyboardEvent) => {
            switch (e.key) {
                case 'ArrowLeft':  this.leftPressed  = false; break;
                case 'ArrowUp':    this.upPressed    = false; break;
                case 'ArrowRight': this.rightPressed = false; break;
                case 'ArrowDown':  this.downPressed  = false; break;
            }
        };
        document.addEventListener('keydown', this.onKeyDown);
        document.addEventListener('keyup',   this.onKeyUp);
    }

    update(actor: IGameObject): void {
        applyPlayerInput(this, actor);
    }

    destroy(): void {
        document.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('keyup',   this.onKeyUp);
        this.leftPressed = this.rightPressed = this.upPressed = this.downPressed = false;
        this.bufferedDir = null;
    }
}
