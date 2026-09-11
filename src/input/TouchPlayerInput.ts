import type { PlayerInput } from './PlayerInput';
import { applyPlayerInput, bufferDir } from './PlayerInput';
import type { Direction, IGameObject } from '../types';
import { Sound } from '../static/Sound';

const MIN_SWIPE_DISTANCE = 40;

export class TouchPlayerInput implements PlayerInput {
    leftPressed  = false;
    rightPressed = false;
    upPressed    = false;
    downPressed  = false;
    bufferedDir: Direction | null = null;
    bufferedDirFramesLeft = 0;

    private touchStartX = 0;
    private touchStartY = 0;
    private swipeFiredThisTouch = false;

    private readonly onTouchStart: (e: TouchEvent) => void;
    private readonly onTouchMove:  (e: TouchEvent) => void;
    private readonly onTouchEnd:   (e: TouchEvent) => void;

    constructor() {
        this.onTouchStart = (e: TouchEvent) => {
            e.preventDefault();
            Sound.init();
            this.touchStartX = e.changedTouches[0].clientX;
            this.touchStartY = e.changedTouches[0].clientY;
            this.swipeFiredThisTouch = false;
        };

        this.onTouchMove = (e: TouchEvent) => {
            e.preventDefault();
            const dx = e.changedTouches[0].clientX - this.touchStartX;
            const dy = e.changedTouches[0].clientY - this.touchStartY;
            if (Math.abs(dx) < MIN_SWIPE_DISTANCE && Math.abs(dy) < MIN_SWIPE_DISTANCE) return;
            this.touchStartX = e.changedTouches[0].clientX;
            this.touchStartY = e.changedTouches[0].clientY;
            this.swipeFiredThisTouch = true;
            this.applySwipe(dx, dy);
        };

        this.onTouchEnd = (e: TouchEvent) => {
            e.preventDefault();
            if (this.swipeFiredThisTouch) return;
            const dx = e.changedTouches[0].clientX - this.touchStartX;
            const dy = e.changedTouches[0].clientY - this.touchStartY;
            if (Math.abs(dx) < MIN_SWIPE_DISTANCE && Math.abs(dy) < MIN_SWIPE_DISTANCE) return;
            this.applySwipe(dx, dy);
        };

        document.addEventListener('touchstart', this.onTouchStart, { passive: false });
        document.addEventListener('touchmove',  this.onTouchMove,  { passive: false });
        document.addEventListener('touchend',   this.onTouchEnd,   { passive: false });
    }

    private applySwipe(dx: number, dy: number): void {
        bufferDir(this, Math.abs(dx) > Math.abs(dy)
            ? (dx < 0 ? 'left' : 'right')
            : (dy < 0 ? 'up'   : 'down'));
    }

    update(actor: IGameObject): void {
        applyPlayerInput(this, actor);
    }

    destroy(): void {
        document.removeEventListener('touchstart', this.onTouchStart);
        document.removeEventListener('touchmove',  this.onTouchMove);
        document.removeEventListener('touchend',   this.onTouchEnd);
        this.bufferedDir = null;
    }
}
