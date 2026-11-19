// =============================================================================
// Modal screens: main menu, character creation, save slots, offline summary and
// life review. Pure DOM builders with callbacks supplied by UIManager.
// =============================================================================
import type { ArchivedLife, NewGameOptions, OfflineSummary, SaveSlotMeta } from '../core/contracts';
import type { CigaretteAppearance } from '../core/contracts';
import { formatMoney, qualityStars } from '../core/format';
import {
  groupOfflineChanges,
  offlineChangeIcon,
  gameTimeText,
  lifeArchiveIcon,
  PATTERN_OPTIONS,
  FACE_OPTIONS,
  BODY_COLOR_PRESETS,
  FILTER_COLOR_PRESETS,
  sanitiseHexColor,
  parseSeed,
  formatDurationClock,
} from './model';
import { h, span, button, badge, empty, section, statTile } from './widgets';

// ---------------------------------------------------------------------------
// Main menu
// ---------------------------------------------------------------------------
export interface MainMenuActions {
  onNewLife(): void;
  onContinue(): void;
  onSaveSlots(): void;
  onLifeArchives(): void;
  onSettings(): void;
  onHelp(): void;
  version: string;
}

export function buildMainMenu(actions: MainMenuActions): HTMLElement {
  const menu = h('div', 'ui-menu');
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', "A Cigarette's Life main menu");
  menu.appendChild(h('div', 'ui-menu-title', "A Cigarette's Life"));
  menu.appendChild(h('div', 'ui-menu-sub', 'a living world · burning slowly'));
  const buttons: [string, () => void, boolean][] = [
    ['New life', actions.onNewLife, true],
    ['Continue', actions.onContinue, false],
    ['Save slots', actions.onSaveSlots, false],
    ['Life archives', actions.onLifeArchives, false],
    ['Settings', actions.onSettings, false],
    ['Help & controls', actions.onHelp, false],
  ];
  for (const [label, handler, primary] of buttons) {
    menu.appendChild(button(label, handler, { className: primary ? 'ui-button-primary' : '' }));
  }
  menu.appendChild(h('div', 'ui-menu-divider'));
  menu.appendChild(h('div', 'ui-menu-foot', 'WASD walk · E interact · I inventory · M map · F12 debugger'));
  menu.appendChild(h('div', 'ui-menu-foot', 'build ' + actions.version + ' · deterministic seeded world · no network'));
  return menu;
}

// ---------------------------------------------------------------------------
// Character creation
// ---------------------------------------------------------------------------
export interface CharacterOptions {
  playerName: string;
  bodyColor: string;
  filterColor: string;
  pattern: CigaretteAppearance['pattern'];
  face: CigaretteAppearance['face'];
  seed: number | null;
}

export function buildCharacterCreation(input: {
  defaults: CigaretteAppearance;
  onConfirm(options: CharacterOptions): void;
}): HTMLElement {
  const wrapper = h('div', 'ui-modal-inner');
  wrapper.appendChild(h('h2', 'ui-modal-title', 'Light a new cigarette'));
  wrapper.appendChild(
    h('div', 'ui-modal-sub', 'Body and filter are just colours. What the world makes of you is decided later.')
  );
  const layout = h('div', 'ui-charcreate');
  const form = h('div', 'ui-charcreate-form');

  const nameLine = h('div', 'ui-form-line');
  nameLine.appendChild(h('label', 'ui-label', 'Name'));
  const nameInput = h('input', 'ui-input');
  nameInput.type = 'text';
  nameInput.maxLength = 24;
  nameInput.placeholder = 'Ash';
  nameInput.value = 'Ash';
  nameInput.setAttribute('aria-label', 'Cigarette name');
  nameLine.appendChild(nameInput);
  form.appendChild(nameLine);

  const body = colorField('Body colour', input.defaults.bodyColor, BODY_COLOR_PRESETS);
  const filter = colorField('Filter colour', input.defaults.filterColor, FILTER_COLOR_PRESETS);
  form.appendChild(body.element);
  form.appendChild(filter.element);

  const patternLine = h('div', 'ui-form-line');
  patternLine.appendChild(h('label', 'ui-label', 'Pattern'));
  const patternSelect = h('select', 'ui-select');
  for (const pattern of PATTERN_OPTIONS) {
    const option = h('option', '', pattern);
    option.value = pattern;
    patternSelect.appendChild(option);
  }
  patternSelect.value = input.defaults.pattern;
  patternLine.appendChild(patternSelect);
  form.appendChild(patternLine);

  const faceLine = h('div', 'ui-form-line');
  faceLine.appendChild(h('label', 'ui-label', 'Face'));
  const faceSelect = h('select', 'ui-select');
  for (const face of FACE_OPTIONS) {
    const option = h('option', '', face);
    option.value = face;
    faceSelect.appendChild(option);
  }
  faceSelect.value = input.defaults.face;
  faceLine.appendChild(faceSelect);
  form.appendChild(faceLine);

  const seedLine = h('div', 'ui-form-line');
  seedLine.appendChild(h('label', 'ui-label', 'Seed (optional)'));
  const seedInput = h('input', 'ui-input');
  seedInput.type = 'text';
  seedInput.inputMode = 'numeric';
  seedInput.placeholder = 'leave blank for a new world';
  seedInput.style.width = '170px';
  seedLine.appendChild(seedInput);
  form.appendChild(seedLine);
  const error = h('div', 'ui-inline-error');
  form.appendChild(error);

  const confirm = button('Light it', () => {
    const name = nameInput.value.trim() || 'Ash';
    const seedText = seedInput.value.trim();
    const seed = parseSeed(seedText);
    if (seedText.length > 0 && seed === null) {
      error.textContent = 'Seed must be a whole number between 0 and 4294967295, or blank.';
      seedInput.classList.add('ui-input-error');
      seedInput.focus();
      return;
    }
    seedInput.classList.remove('ui-input-error');
    error.textContent = '';
    input.onConfirm({
      playerName: name,
      bodyColor: sanitiseHexColor(body.getValue(), input.defaults.bodyColor),
      filterColor: sanitiseHexColor(filter.getValue(), input.defaults.filterColor),
      pattern: patternSelect.value as CigaretteAppearance['pattern'],
      face: faceSelect.value as CigaretteAppearance['face'],
      seed,
    });
  }, { className: 'ui-button-primary' });
  form.appendChild(confirm);
  layout.appendChild(form);

  // Live preview
  const preview = h('div', 'ui-charcreate-preview');
  const cigarette = h('div', 'ui-preview-cigarette');
  const faceEmoji = h('div', 'ui-preview-face', '🙂');
  cigarette.appendChild(faceEmoji);
  const filterPreview = h('div', 'ui-preview-filter');
  preview.append(h('div', 'ui-preview-label', 'preview'), cigarette, filterPreview, h('div', 'ui-preview-name', 'Ash'));
  const updatePreview = (): void => {
    cigarette.style.background = sanitiseHexColor(body.getValue(), input.defaults.bodyColor);
    filterPreview.style.background = sanitiseHexColor(filter.getValue(), input.defaults.filterColor);
    cigarette.className = 'ui-preview-cigarette pattern-' + patternSelect.value;
    faceEmoji.textContent = faceEmojiFor(faceSelect.value);
    const previewName = preview.querySelector('.ui-preview-name');
    if (previewName) previewName.textContent = nameInput.value.trim() || 'Ash';
  };
  body.onInput.push(updatePreview);
  filter.onInput.push(updatePreview);
  patternSelect.addEventListener('change', updatePreview);
  faceSelect.addEventListener('change', updatePreview);
  nameInput.addEventListener('input', updatePreview);
  updatePreview();
  layout.appendChild(preview);
  wrapper.appendChild(layout);
  requestAnimationFrame(() => nameInput.focus());
  return wrapper;
}

interface ColorField {
  element: HTMLElement;
  getValue(): string;
  onInput: (() => void)[];
}

function colorField(label: string, initial: string, presets: readonly string[]): ColorField {
  const onInput: (() => void)[] = [];
  const line = h('div', 'ui-form-line');
  line.appendChild(h('label', 'ui-label', label));
  const hex = h('input', 'ui-input');
  hex.type = 'text';
  hex.value = initial;
  hex.maxLength = 7;
  hex.style.width = '84px';
  hex.setAttribute('aria-label', label + ' hex value');
  line.appendChild(hex);
  const native = h('input', 'ui-input');
  native.type = 'color';
  native.value = initial;
  native.setAttribute('aria-label', label + ' picker');
  line.appendChild(native);
  const swatches = h('div', 'ui-swatch-row');
  const setColor = (value: string): void => {
    const safe = sanitiseHexColor(value, initial);
    hex.value = safe;
    native.value = safe;
    for (const child of swatches.children) {
      child.classList.toggle('active', (child as HTMLElement).dataset.color === safe);
    }
    for (const listener of onInput) listener();
  };
  for (const color of presets) {
    const swatch = h('button', 'ui-swatch');
    swatch.type = 'button';
    swatch.dataset.color = color;
    swatch.style.background = color;
    swatch.setAttribute('aria-label', 'Use colour ' + color);
    swatch.addEventListener('click', () => setColor(color));
    swatches.appendChild(swatch);
  }
  line.appendChild(swatches);
  hex.addEventListener('change', () => setColor(hex.value));
  native.addEventListener('input', () => setColor(native.value));
  return { element: line, getValue: () => hex.value, onInput };
}

export function faceEmojiFor(face: string): string {
  switch (face) {
    case 'smile':
      return '🙂';
    case 'neutral':
      return '😐';
    case 'wink':
      return '😉';
    case 'surprised':
      return '😮';
    case 'sleepy':
      return '😴';
    default:
      return '🙂';
  }
}

// ---------------------------------------------------------------------------
// Save slots
// ---------------------------------------------------------------------------
export interface SaveSlotHandlers {
  onLoad(slotId: string): void;
  onDelete(slotId: string): void;
  onExport(slotId: string): Promise<string | null>;
  onImport(json: string, slotId: string): Promise<{ ok: boolean; message: string }>;
  onNewLife(): void;
}

export function buildSaveSlots(input: {
  slots: SaveSlotMeta[];
  handlers: SaveSlotHandlers;
  statusText?: string;
}): HTMLElement {
  const wrapper = h('div', 'ui-modal-inner');
  wrapper.appendChild(h('h2', 'ui-modal-title', 'Save slots'));
  wrapper.appendChild(h('div', 'ui-modal-sub', 'Load a life, delete one, or move saves between browsers as JSON.'));
  const status = h('div', 'ui-inline-error', input.statusText ?? '');
  wrapper.appendChild(status);
  const exportArea = h('textarea', 'ui-textarea');
  exportArea.placeholder = 'Exported save JSON appears here. Paste JSON here to import it.';
  exportArea.style.display = 'none';
  if (input.slots.length === 0) {
    wrapper.appendChild(empty('No saves yet. Start a new life below.'));
  }
  for (const slot of input.slots) {
    const row = h('div', 'ui-save-slot');
    const info = h('div', 'info');
    info.appendChild(h('div', 'slot-name', slot.playerName + ' · generation ' + slot.generation));
    info.appendChild(
      h(
        'div',
        'slot-meta',
        'year ' + slot.year + ' · ' + slot.season + ' ' + slot.dayOfSeason + ' · ' + formatMoney(slot.money) + ' · played ' + formatDurationClock(slot.playTimeSeconds) + ' · ' + new Date(slot.savedAt).toLocaleString()
      )
    );
    info.appendChild(h('div', 'slot-meta', 'slot ' + slot.slotId + ' · v' + slot.saveVersion + ' · checksum ' + slot.checksum.slice(0, 8)));
    row.appendChild(info);
    const actions = h('div', 'actions');
    actions.appendChild(button('Load', () => input.handlers.onLoad(slot.slotId), { className: 'ui-button-small ui-button-primary' }));
    actions.appendChild(button('Export', () => {
      void input.handlers.onExport(slot.slotId).then((json) => {
        exportArea.style.display = '';
        if (json === null) {
          status.textContent = 'This slot could not be exported.';
          return;
        }
        exportArea.value = json;
        status.textContent = 'Exported. Copy the JSON below somewhere safe.';
      });
    }, { className: 'ui-button-small' }));
    actions.appendChild(button('Delete', () => input.handlers.onDelete(slot.slotId), { className: 'ui-button-small ui-button-danger' }));
    row.appendChild(actions);
    wrapper.appendChild(row);
  }
  wrapper.appendChild(exportArea);
  const copyRow = h('div', 'ui-inline');
  copyRow.appendChild(
    button('Copy JSON', () => {
      if (exportArea.value.length === 0) {
        status.textContent = 'Nothing exported yet.';
        return;
      }
      exportArea.select();
      try {
        void navigator.clipboard?.writeText(exportArea.value).then(
          () => {
            status.textContent = 'Copied to clipboard.';
          },
          () => {
            status.textContent = 'Clipboard unavailable - the text is selected, copy it manually.';
          }
        );
      } catch {
        status.textContent = 'Clipboard unavailable - the text is selected, copy it manually.';
      }
    }, { className: 'ui-button-small' })
  );
  wrapper.appendChild(copyRow);
  const importSection = section('Import a save', 'paste JSON and pick a destination slot');
  const slotLine = h('div', 'ui-form-line');
  slotLine.appendChild(h('label', 'ui-label', 'Destination slot'));
  const slotInput = h('input', 'ui-input');
  slotInput.type = 'text';
  slotInput.value = 'imported_slot';
  slotInput.maxLength = 32;
  slotLine.appendChild(slotInput);
  importSection.body.appendChild(slotLine);
  const importArea = h('textarea', 'ui-textarea');
  importArea.placeholder = 'Paste exported save JSON here';
  importSection.body.appendChild(importArea);
  importSection.body.appendChild(
    button('Import save', () => {
      const json = importArea.value.trim();
      if (json.length === 0) {
        status.textContent = 'Paste a save JSON document first.';
        return;
      }
      const target = slotInput.value.trim() || 'imported_slot';
      void input.handlers.onImport(json, target).then((result) => {
        status.textContent = result.message;
        if (result.ok) status.style.color = 'var(--acg-green)';
      });
    }, { className: 'ui-button-small ui-button-primary' })
  );
  wrapper.appendChild(importSection.element);
  wrapper.appendChild(button('Start a new life', () => input.handlers.onNewLife(), { className: 'ui-button-small' }));
  return wrapper;
}

// ---------------------------------------------------------------------------
// Offline summary
// ---------------------------------------------------------------------------
export function buildOfflineSummary(summary: OfflineSummary): HTMLElement {
  const wrapper = h('div', 'ui-modal-inner');
  wrapper.appendChild(h('h2', 'ui-modal-title', 'While you were away'));
  wrapper.appendChild(h('div', 'ui-offline-headline', summary.headline));
  const stats = h('div', 'ui-stats');
  stats.append(
    statTile('Real time away', formatRealDuration(summary.realElapsedMs)),
    statTile('Game time passed', formatDurationClock(summary.simulatedGameHours * 60)),
    statTile('From', gameTimeText(summary.fromSimTime)),
    statTile('To', gameTimeText(summary.toSimTime))
  );
  wrapper.appendChild(stats);
  if (summary.highlights.length > 0) {
    const highlights = section('Highlights');
    for (const highlight of summary.highlights) highlights.body.appendChild(h('div', 'ui-list-item', highlight));
    wrapper.appendChild(highlights.element);
  }
  if (summary.changes.length > 0) {
    const changes = section('What changed', summary.changes.length + ' changes');
    for (const group of groupOfflineChanges(summary.changes)) {
      const groupHead = h('div', 'ui-section-title', offlineChangeIcon(group.kind) + ' ' + group.kind);
      changes.body.appendChild(groupHead);
      for (const change of group.items.slice(0, 10)) {
        changes.body.appendChild(h('div', 'ui-offline-change', change.description));
      }
    }
    wrapper.appendChild(changes.element);
  } else {
    wrapper.appendChild(empty('Nothing notable changed while you were gone.'));
  }
  if (summary.importantNpcUpdates.length > 0) {
    const people = section('People you know');
    for (const update of summary.importantNpcUpdates) {
      people.body.appendChild(h('div', 'ui-list-item', update.name + ' — ' + update.description));
    }
    wrapper.appendChild(people.element);
  }
  if (summary.letters.length > 0) {
    const letters = section('New letters', String(summary.letters.length));
    for (const letter of summary.letters) letters.body.appendChild(h('div', 'ui-list-item', '✉ ' + letter.subject));
    wrapper.appendChild(letters.element);
  }
  if (summary.newEvents.length > 0) {
    wrapper.appendChild(h('div', 'ui-card-sub', summary.newEvents.length + ' new world events were logged in the journal.'));
  }
  return wrapper;
}

// ---------------------------------------------------------------------------
// Life review
// ---------------------------------------------------------------------------
export function buildLifeReview(input: {
  life: ArchivedLife;
  legacyOptions: { itemId: string; name: string }[];
  onNextLife(itemIds: string[]): void;
  onClose(): void;
}): HTMLElement {
  const life = input.life;
  const wrapper = h('div', 'ui-modal-inner');
  wrapper.appendChild(h('h2', 'ui-modal-title', 'The life of ' + life.name));
  wrapper.appendChild(
    h(
      'div',
      'ui-modal-sub',
      'generation ' + life.generation + ' · lived ' + life.durationDays.toFixed(1) + ' days · ' + life.endReason
    )
  );
  const stats = h('div', 'ui-stats');
  stats.append(
    statTile('Home', life.residenceName),
    statTile('Occupation', life.occupation ?? 'none'),
    statTile('Money left', formatMoney(life.finalMoney)),
    statTile('People mattered', String(life.importantPeople.length)),
    statTile('Collected species', String(life.collections.length)),
    statTile('World changes', String(life.worldChanges.length)),
    statTile('Skills total', String(Object.values(life.skills).reduce((sum, value) => sum + value, 0))),
    statTile('Legacy mementos', String(life.legacyItemIds.length))
  );
  wrapper.appendChild(stats);
  const told = section('Life story', life.archive.length + ' recorded moments');
  const timeline = h('div', 'ui-timeline');
  for (const entry of [...life.archive].reverse().slice(0, 24)) {
    const row = h('div', 'ui-timeline-entry' + (entry.importance >= 3 ? ' important' : ''));
    row.appendChild(h('div', 'ui-timeline-title', lifeArchiveIcon(entry.category) + ' ' + entry.title));
    row.appendChild(h('div', 'ui-timeline-desc', entry.description));
    const meta = h('div', 'ui-timeline-meta');
    meta.appendChild(span('', gameTimeText(entry.at)));
    row.appendChild(meta);
    timeline.appendChild(row);
  }
  if (life.archive.length === 0) timeline.appendChild(empty('Nothing was recorded. A quiet life.'));
  told.body.appendChild(timeline);
  wrapper.appendChild(told.element);

  if (life.importantPeople.length > 0) {
    const people = section('People who mattered');
    const grid = h('div', 'ui-inline');
    for (const person of life.importantPeople) {
      grid.appendChild(
        badge(person.name + ' · ' + person.status.replaceAll('_', ' ') + ' (' + Math.round(person.affinity) + ')', 'neutral')
      );
    }
    people.body.appendChild(grid);
    wrapper.appendChild(people.element);
  }
  if (life.worldChanges.length > 0) {
    const world = section('The world remembers');
    for (const change of life.worldChanges) world.body.appendChild(h('div', 'ui-list-item', change));
    wrapper.appendChild(world.element);
  }
  if (life.collections.length > 0) {
    const collection = section('Collection left behind', String(life.collections.length) + ' species');
    for (const entry of life.collections.slice(0, 12)) {
      collection.body.appendChild(h('div', 'ui-list-item', this_resolve(entry.itemId) + ' ×' + entry.count));
    }
    wrapper.appendChild(collection.element);
  }
  if (life.worldChanges.length === 0 && life.collections.length === 0 && life.importantPeople.length === 0) {
    wrapper.appendChild(empty('The world barely noticed. Perhaps the next cigarette will live louder.'));
  }
  if (input.legacyOptions.length > 0) {
    const legacy = section('Choose up to three mementos', 'they carry into the next life');
    const selected = new Set<string>();
    const selectedLabel = h('div', 'ui-card-sub', '0 / 3 chosen');
    const grid = h('div', 'ui-memento-grid');
    for (const option of input.legacyOptions) {
      const item = h('label', 'ui-memento');
      const checkbox = h('input', '');
      checkbox.type = 'checkbox';
      item.appendChild(checkbox);
      item.appendChild(span('', option.name));
      const refresh = (): void => {
        const checked = checkbox.checked;
        if (checked) selected.add(option.itemId);
        else selected.delete(option.itemId);
        if (selected.size > 3) {
          checkbox.checked = false;
          selected.delete(option.itemId);
        }
        if (checkbox.checked) item.classList.add('selected');
        else item.classList.remove('selected');
        selectedLabel.textContent = selected.size + ' / 3 chosen';
      };
      checkbox.addEventListener('change', refresh);
      grid.appendChild(item);
    }
    legacy.body.appendChild(grid);
    legacy.body.appendChild(selectedLabel);
    wrapper.appendChild(legacy.element);
    wrapper.appendChild(
      button('Light the next cigarette', () => {
        input.onNextLife([...selected]);
      }, { className: 'ui-button-primary' })
    );
  } else {
    wrapper.appendChild(
      h('div', 'ui-card-text', 'No keepsake survived this life. The next cigarette starts with nothing but the world you left behind.')
    );
    wrapper.appendChild(
      button('Light the next cigarette', () => {
        input.onNextLife([]);
      }, { className: 'ui-button-primary' })
    );
  }
  wrapper.appendChild(button('Close', () => input.onClose(), { className: 'ui-button-small' }));
  return wrapper;
}

function this_resolve(itemId: string): string {
  return itemId.replaceAll('_', ' ');
}

function formatRealDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours >= 24) return Math.floor(hours / 24) + 'd ' + (hours % 24) + 'h';
  return hours > 0 ? hours + 'h ' + minutes + 'm' : minutes + 'm';
}

// Re-exported for UIManager convenience.
export function toNewGameOptions(options: CharacterOptions, appearance: CigaretteAppearance): NewGameOptions {
  const result: NewGameOptions = {
    playerName: options.playerName,
    appearance: {
      bodyColor: options.bodyColor,
      filterColor: options.filterColor,
      accessory: appearance.accessory,
      face: options.face,
      pattern: options.pattern,
    },
  };
  if (options.seed !== null) result.seed = options.seed;
  return result;
}
