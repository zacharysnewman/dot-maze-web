import type { LibraryEntry } from './LevelLibrary';
import { formatDate, listLevels } from './LevelLibrary';
import { countUsage } from './TileSet';

export interface LibraryModalControls {
    close: () => void;
    refresh: () => void;
}

export interface LibraryAction {
    label: string;
    /** Colours the button: green for the main action, blue for a secondary, red for destructive. */
    tone: 'load' | 'test' | 'delete';
    onClick: (entry: LibraryEntry, controls: LibraryModalControls) => void;
}

export interface LibraryModalOptions {
    title: string;
    /** Shown in place of the list when nothing has been saved yet. */
    emptyMessage: string;
    actions: (entry: LibraryEntry) => LibraryAction[];
    /** An option that is not a saved map — the stock maze, for instance. */
    lead?: { label: string; onClick: (controls: LibraryModalControls) => void };
}

/**
 * The saved-maps list, shared by the editor and the online lobby.
 *
 * The editor loads, play-tests and deletes from it; a host picks the map
 * everyone is about to play. Same list, same cards, different buttons — which
 * is the whole reason this is one modal and not two.
 */
export function openLibraryModal(options: LibraryModalOptions): LibraryModalControls {
    document.getElementById('ed-library-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ed-library-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', options.title);
    overlay.innerHTML = `
    <style>
    #ed-library-modal {
        position: fixed; inset: 0; background: rgba(0,0,0,0.85);
        z-index: 2200; display: flex; align-items: center; justify-content: center;
        font-family: monospace; padding: 12px;
    }
    #ed-lib-box {
        background: #111; border: 2px solid #666; border-radius: 12px;
        padding: 18px; width: 100%; max-width: 460px;
        max-height: 86vh; display: flex; flex-direction: column; gap: 12px;
        color: #eee;
    }
    #ed-lib-box h3 { color: #ff0; margin: 0; font-size: 20px; }
    #ed-lib-list {
        overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 10px;
        touch-action: pan-y; overscroll-behavior: contain;
    }
    .ed-lib-entry {
        background: #1a1a1a; border: 1px solid #333; border-radius: 8px;
        padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
    }
    .ed-lib-entry-name { font-size: 16px; color: #ff0; font-weight: bold; }
    .ed-lib-entry-meta { font-size: 12px; color: #999; }
    .ed-lib-entry-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .ed-lib-entry-actions button {
        flex: 1 1 90px; min-height: 44px; background: #222; color: #eee;
        border: 1px solid #555; border-radius: 6px; padding: 6px 8px; cursor: pointer;
        font-family: monospace; font-size: 14px;
    }
    #ed-library-modal button:focus-visible, #ed-library-modal :focus-visible {
        outline: 3px solid #ff0; outline-offset: 2px;
    }
    .ed-lib-btn-load  { color: #9f9 !important; border-color: #4a4 !important; }
    .ed-lib-btn-test  { color: #9bf !important; border-color: #46a !important; }
    .ed-lib-btn-del   { color: #f88 !important; border-color: #a33 !important; }
    #ed-lib-empty { color: #888; font-size: 14px; text-align: center; padding: 20px 0; }
    #ed-lib-lead, #ed-lib-close {
        background: #222; color: #eee; border: 1px solid #666;
        border-radius: 6px; padding: 10px 16px; cursor: pointer; min-height: 48px;
        font-family: monospace; font-size: 16px; align-self: stretch;
    }
    #ed-lib-lead { color: #ff0; border-color: #886; }
    </style>
    <div id="ed-lib-box">
        <h3></h3>
        <div id="ed-lib-list"></div>
        <button id="ed-lib-close">✕ Close</button>
    </div>`;
    (overlay.querySelector('#ed-lib-box h3') as HTMLElement).textContent = options.title;
    document.body.appendChild(overlay);

    // Keep every gesture off the canvas underneath.
    overlay.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    overlay.addEventListener('touchend',   e => e.stopPropagation(), { passive: true });
    overlay.addEventListener('click',      e => e.stopPropagation());
    overlay.addEventListener('mousedown',  e => e.stopPropagation());

    const controls: LibraryModalControls = {
        close: () => overlay.remove(),
        refresh: () => refreshList(),
    };

    const closeBtn = overlay.querySelector('#ed-lib-close') as HTMLButtonElement;
    closeBtn.onclick = controls.close;
    closeBtn.focus();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) controls.close(); });
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') controls.close(); });

    function refreshList(): void {
        const listEl = overlay.querySelector('#ed-lib-list') as HTMLElement;
        listEl.innerHTML = '';

        if (options.lead !== undefined) {
            const lead = document.createElement('button');
            lead.id = 'ed-lib-lead';
            lead.textContent = options.lead.label;
            lead.onclick = () => options.lead?.onClick(controls);
            listEl.appendChild(lead);
        }

        const entries = listLevels();
        if (entries.length === 0) {
            const empty = document.createElement('div');
            empty.id = 'ed-lib-empty';
            empty.innerHTML = options.emptyMessage;
            listEl.appendChild(empty);
            return;
        }

        for (const entry of [...entries].reverse()) {
            const counts = countUsage(entry.level);
            const div = document.createElement('div');
            div.className = 'ed-lib-entry';
            div.innerHTML = `
                <div class="ed-lib-entry-name"></div>
                <div class="ed-lib-entry-meta"></div>
                <div class="ed-lib-entry-actions"></div>`;
            (div.querySelector('.ed-lib-entry-name') as HTMLElement).textContent =
                entry.level.name || '(Untitled)';
            (div.querySelector('.ed-lib-entry-meta') as HTMLElement).textContent =
                `${formatDate(entry.savedAt)} · ${counts.dot} dots · ${counts.power} power`;

            const actionsEl = div.querySelector('.ed-lib-entry-actions') as HTMLElement;
            for (const action of options.actions(entry)) {
                const button = document.createElement('button');
                button.className = `ed-lib-btn-${action.tone === 'delete' ? 'del' : action.tone}`;
                button.textContent = action.label;
                button.addEventListener('click', () => action.onClick(entry, controls));
                actionsEl.appendChild(button);
            }

            listEl.appendChild(div);
        }
    }

    refreshList();
    return controls;
}
