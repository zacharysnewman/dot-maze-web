import type { PlayerInput } from './PlayerInput';
import type { Direction, IGameObject } from '../types';

const BUFFER_FRAMES = 8;

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
                case 'ArrowLeft':  this.leftPressed  = true; this.buffer('left');  break;
                case 'ArrowUp':    this.upPressed    = true; this.buffer('up');    break;
                case 'ArrowRight': this.rightPressed = true; this.buffer('right'); break;
                case 'ArrowDown':  this.downPressed  = true; this.buffer('down');  break;
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

    private buffer(dir: Direction): void {
        this.bufferedDir = dir;
        this.bufferedDirFramesLeft = BUFFER_FRAMES;
    }

    update(actor: IGameObject): void {
        if (this.leftPressed  && (actor.leftObject()   ?? 0) > 2) actor.moveDir = 'left';
        if (this.upPressed    && (actor.topObject()    ?? 0) > 2) actor.moveDir = 'up';
        if (this.rightPressed && (actor.rightObject()  ?? 0) > 2) actor.moveDir = 'right';
        if (this.downPressed  && (actor.bottomObject() ?? 0) > 2) actor.moveDir = 'down';

        if (this.bufferedDir !== null) {
            const dir = this.bufferedDir;
            const tileOpen =
                dir === 'left'  ? (actor.leftObject()   ?? 0) > 2 :
                dir === 'right' ? (actor.rightObject()  ?? 0) > 2 :
                dir === 'up'    ? (actor.topObject()    ?? 0) > 2 :
                                  (actor.bottomObject() ?? 0) > 2;
            if (tileOpen) {
                actor.moveDir = dir;
                this.bufferedDir = null;
                this.bufferedDirFramesLeft = 0;
            } else {
                this.bufferedDirFramesLeft--;
                if (this.bufferedDirFramesLeft <= 0) this.bufferedDir = null;
            }
        }
    }

    destroy(): void {
        document.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('keyup',   this.onKeyUp);
        this.leftPressed = this.rightPressed = this.upPressed = this.downPressed = false;
        this.bufferedDir = null;
    }
}
