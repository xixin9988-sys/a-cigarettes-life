import type { ActionErrorCode, ActionResult, CigaretteAppearance, GameState } from '../core/contracts';

/**
 * Player identity: cigarette appearance validation / customisation, display names and the
 * occupation line shown on the life panel.
 *
 * The player is a cigarette, so "identity" is body colour, filter colour, drawn-on face,
 * paper pattern and an optional accessory plus the occupation earned in the world.
 */

export type CigaretteFace = CigaretteAppearance['face'];
export type CigarettePattern = CigaretteAppearance['pattern'];

export const VALID_FACES: readonly CigaretteFace[] = ['smile', 'neutral', 'wink', 'surprised', 'sleepy'];
export const VALID_PATTERNS: readonly CigarettePattern[] = ['plain', 'stripe', 'dots', 'zigzag'];
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const MAX_NAME_LENGTH = 24;
const MAX_ACCESSORY_LENGTH = 40;

export interface AppearanceValidation {
  ok: boolean;
  message: string;
  code?: ActionErrorCode;
  /** Sanitised appearance, present when ok. */
  value?: CigaretteAppearance;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Validates untrusted appearance input (UI / save data) before it reaches the state. */
export function validateCigaretteAppearance(input: unknown): AppearanceValidation {
  if (!isRecord(input)) {
    return { ok: false, message: 'That is not a cigarette appearance.', code: 'invalid' };
  }
  const bodyColor = input['bodyColor'];
  const filterColor = input['filterColor'];
  const accessory = input['accessory'];
  const face = input['face'];
  const pattern = input['pattern'];

  if (typeof bodyColor !== 'string' || !HEX_COLOR_PATTERN.test(bodyColor)) {
    return { ok: false, message: 'Body colour must be a hex colour like #f7f3e8.', code: 'invalid' };
  }
  if (typeof filterColor !== 'string' || !HEX_COLOR_PATTERN.test(filterColor)) {
    return { ok: false, message: 'Filter colour must be a hex colour like #b07a4a.', code: 'invalid' };
  }
  if (typeof face !== 'string' || !(VALID_FACES as readonly string[]).includes(face)) {
    return { ok: false, message: 'Choose a face: smile, neutral, wink, surprised or sleepy.', code: 'invalid' };
  }
  if (typeof pattern !== 'string' || !(VALID_PATTERNS as readonly string[]).includes(pattern)) {
    return { ok: false, message: 'Choose a paper pattern: plain, stripe, dots or zigzag.', code: 'invalid' };
  }
  if (accessory !== null && accessory !== undefined) {
    if (typeof accessory !== 'string' || accessory.length > MAX_ACCESSORY_LENGTH) {
      return { ok: false, message: 'That accessory cannot be worn.', code: 'invalid' };
    }
  }
  const value: CigaretteAppearance = {
    bodyColor: bodyColor.toLowerCase(),
    filterColor: filterColor.toLowerCase(),
    accessory: typeof accessory === 'string' && accessory.trim().length > 0 ? accessory.trim() : null,
    face: face as CigaretteFace,
    pattern: pattern as CigarettePattern,
  };
  return { ok: true, message: 'A fine-looking cigarette.', value };
}

export class PlayerIdentitySystem {
  /** Applies a validated appearance to the player, returning a clear ActionResult. */
  customize(state: GameState, appearance: CigaretteAppearance): ActionResult {
    const validation = validateCigaretteAppearance(appearance);
    if (!validation.ok || !validation.value) {
      return { ok: false, message: validation.message, code: validation.code ?? 'invalid' };
    }
    state.player.appearance = validation.value;
    return { ok: true, message: 'You smooth your paper and admire the new look.', stateChanged: true };
  }

  /** Sanitises a persisted name (used on load / new game). */
  sanitizeName(name: string | null | undefined): string {
    const trimmed = (name ?? '').trim();
    if (trimmed.length === 0) return 'Ash';
    return trimmed.slice(0, MAX_NAME_LENGTH);
  }

  getDisplayName(state: GameState): string {
    return this.sanitizeName(state.player.name);
  }

  /** Short occupation label used by the HUD and life panel. */
  getOccupationLabel(state: GameState): string {
    const occupation = state.player.occupation;
    if (!occupation || occupation.trim().length === 0) return 'Wanderer';
    return occupation;
  }

  /** Name plus occupation, e.g. "Ash the Gardener" or "Ash, Wanderer". */
  getTitle(state: GameState): string {
    const name = this.getDisplayName(state);
    const occupation = this.getOccupationLabel(state);
    if (occupation === 'Wanderer') return name + ', ' + occupation;
    return name + ' the ' + occupation;
  }

  /** Human-readable appearance summary for the life panel. */
  describeAppearance(appearance: CigaretteAppearance): string {
    const face = appearance.face;
    const pattern = appearance.pattern === 'plain' ? 'plain paper' : appearance.pattern + ' paper';
    const accessory = appearance.accessory ? ', wearing ' + appearance.accessory : '';
    return 'A ' + pattern + ' cigarette with a ' + appearance.filterColor + ' filter and a ' + face + ' face' + accessory + '.';
  }

  /** Renders a colour swatch pair for UI previews. */
  getPalette(appearance: CigaretteAppearance): { body: string; filter: string } {
    return { body: appearance.bodyColor, filter: appearance.filterColor };
  }
}
