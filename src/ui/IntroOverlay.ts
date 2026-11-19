/**
 * Plays the studio intro page (public/beginning.html) over the whole viewport when the game
 * launches, then fades it away so the player enters the game.
 *
 * Skipping: click/tap anywhere, press Enter/Space/Escape, or the "SKIP" button. Automated runs
 * can bypass it entirely with ?skipIntro=1 (handled pre-paint via a tiny inline script in
 * index.html). The intro auto-finishes after the logo animation has played and held briefly.
 */
export class IntroOverlay {
  private static readonly AUTO_FINISH_MS = 5200;
  private static readonly FADE_MS = 650;

  private readonly root: HTMLElement | null;
  private readonly iframe: HTMLIFrameElement | null;
  private readonly donePromise: Promise<void>;
  private resolveDone: () => void = () => undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private done = false;
  private readonly cleanups: (() => void)[] = [];

  constructor() {
    this.root = document.getElementById('intro-overlay');
    this.iframe = document.getElementById('intro-frame') as HTMLIFrameElement | null;
    this.donePromise = new Promise<void>((resolve) => {
      this.resolveDone = resolve;
    });
    if (!this.root) {
      this.resolveDone();
      return;
    }
    if (new URLSearchParams(window.location.search).has('skipIntro')) {
      this.finish(true);
      return;
    }
    this.wireSkipControls();
    this.timer = setTimeout(() => this.finish(false), IntroOverlay.AUTO_FINISH_MS);
  }

  /** Resolves once the intro is over and the game should become visible. */
  whenDone(): Promise<void> {
    return this.donePromise;
  }

  isDone(): boolean {
    return this.done;
  }

  /** Ends the intro early (skip button / click / key / automated tests). */
  finish(immediate = false): void {
    if (this.done) return;
    this.done = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    document.documentElement.dataset.intro = 'done';
    const root = this.root;
    if (!root) {
      this.resolveDone();
      return;
    }
    if (immediate) {
      root.classList.add('intro-hidden');
      root.remove();
      this.resolveDone();
      return;
    }
    root.classList.add('intro-leaving');
    this.resolveDone();
    this.fadeTimer = setTimeout(() => {
      root.remove();
      this.fadeTimer = null;
    }, IntroOverlay.FADE_MS);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.timer = null;
    this.fadeTimer = null;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
  }

  private wireSkipControls(): void {
    const skipButton = document.getElementById('intro-skip');
    if (skipButton) {
      const onClick = (event: Event): void => {
        event.preventDefault();
        event.stopPropagation();
        this.finish(false);
      };
      skipButton.addEventListener('click', onClick);
      this.cleanups.push(() => skipButton.removeEventListener('click', onClick));
    }

    // Any click on the overlay chrome skips (e.g. the hint text / empty margin).
    const onRootClick = (): void => this.finish(false);
    this.root?.addEventListener('pointerdown', onRootClick);
    this.cleanups.push(() => this.root?.removeEventListener('pointerdown', onRootClick));

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') {
        event.preventDefault();
        this.finish(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    this.cleanups.push(() => window.removeEventListener('keydown', onKeyDown));

    // The intro page lives in a same-origin iframe: forward clicks and keys from inside it.
    if (this.iframe) {
      const wireFrame = (): void => {
        try {
          const frameDocument = this.iframe?.contentDocument;
          const frameWindow = this.iframe?.contentWindow;
          if (!frameDocument || !frameWindow) return;
          const frameSkip = (): void => this.finish(false);
          frameDocument.addEventListener('pointerdown', frameSkip);
          frameWindow.addEventListener('keydown', onKeyDown);
          this.cleanups.push(() => frameDocument.removeEventListener('pointerdown', frameSkip));
          this.cleanups.push(() => frameWindow.removeEventListener('keydown', onKeyDown));
        } catch {
          // If the iframe cannot be inspected, the overlay chrome and keyboard still skip.
        }
      };
      if (this.iframe.contentDocument?.readyState === 'complete') wireFrame();
      else {
        const onLoad = (): void => wireFrame();
        this.iframe.addEventListener('load', onLoad, { once: true });
        this.cleanups.push(() => this.iframe?.removeEventListener('load', onLoad));
      }
    }
  }
}