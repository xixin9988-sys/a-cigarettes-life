// =============================================================================
// Minimal DOM implementation used only by the UI smoke test. It is intentionally
// small: enough of the browser API surface for UIManager and the panels to mount,
// render, update and react to clicks/keys headlessly in node.
// =============================================================================
export interface FakeEvent {
  type: string;
  target: FakeElement;
  key: string;
  defaultPrevented: boolean;
  propagationStopped: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

export class FakeNode {
  static readonly ELEMENT_NODE = 1;
  static readonly TEXT_NODE = 3;
  readonly nodeType: number;
  parentNode: FakeNode | null = null;
  children: FakeNode[] = [];

  constructor(nodeType: number) {
    this.nodeType = nodeType;
  }

  get childNodes(): FakeNode[] {
    return this.children;
  }

  get firstChild(): FakeNode | null {
    return this.children[0] ?? null;
  }

  get firstElementChild(): FakeElement | null {
    for (const child of this.children) if (child instanceof FakeElement) return child;
    return null;
  }

  get childElementCount(): number {
    return this.children.filter((child) => child instanceof FakeElement).length;
  }

  get nextSibling(): FakeNode | null {
    if (!this.parentNode) return null;
    const index = this.parentNode.children.indexOf(this);
    return index >= 0 ? this.parentNode.children[index + 1] ?? null : null;
  }

  appendChild<T extends FakeNode>(child: T): T {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: (FakeNode | string)[]): void {
    for (const node of nodes) this.appendChild(typeof node === 'string' ? new FakeText(node) : node);
  }

  prepend(...nodes: (FakeNode | string)[]): void {
    for (const node of nodes.reverse()) {
      const child = typeof node === 'string' ? new FakeText(node) : node;
      child.parentNode = this;
      this.children.unshift(child);
    }
  }

  insertBefore<T extends FakeNode>(child: T, reference: FakeNode | null): T {
    if (!reference) return this.appendChild(child);
    const index = this.children.indexOf(reference);
    child.parentNode = this;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  removeChild<T extends FakeNode>(child: T): T {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  replaceChildren(...nodes: (FakeNode | string)[]): void {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...nodes);
  }

  remove(): void {
    this.parentNode?.removeChild(this);
  }

  contains(node: FakeNode | null): boolean {
    let cursor: FakeNode | null = node;
    while (cursor) {
      if (cursor === this) return true;
      cursor = cursor.parentNode;
    }
    return false;
  }

  get textContent(): string {
    let text = '';
    for (const child of this.children) text += child.textContent;
    return text;
  }

  set textContent(value: string) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    if (value.length > 0) this.appendChild(new FakeText(value));
  }
}

export class FakeText extends FakeNode {
  constructor(text: string) {
    super(FakeNode.TEXT_NODE);
    this._text = text;
  }

  private _text: string;

  override get textContent(): string {
    return this._text;
  }

  override set textContent(value: string) {
    this._text = value;
  }
}

interface Listener {
  fn: (event: FakeEvent) => void;
  capture: boolean;
}

export class FakeElement extends FakeNode {
  readonly tagName: string;
  private _className = '';
  id = '';
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Listener[]>();
  disabled = false;
  checked = false;
  value = '';
  type = '';
  title = '';
  tabIndex = 0;
  maxLength = 0;
  inputMode = '';
  placeholder = '';
  min = '';
  max = '';
  step = '';
  selectable = true;
  isContentEditable = false;
  focusCount = 0;

  constructor(tagName: string) {
    super(FakeNode.ELEMENT_NODE);
    this.tagName = tagName.toUpperCase();
  }

  get className(): string {
    return this._className;
  }

  set className(value: string) {
    this._className = value;
  }

  get classList(): {
    add(...names: string[]): void;
    remove(...names: string[]): void;
    toggle(name: string, force?: boolean): boolean;
    contains(name: string): boolean;
  } {
    const read = (): string[] => this._className.split(/\s+/).filter((token) => token.length > 0);
    return {
      add: (...names: string[]): void => {
        const current = read();
        for (const name of names) if (!current.includes(name)) current.push(name);
        this._className = current.join(' ');
      },
      remove: (...names: string[]): void => {
        this._className = read().filter((token) => !names.includes(token)).join(' ');
      },
      toggle: (name: string, force?: boolean): boolean => {
        const has = read().includes(name);
        const shouldHave = force === undefined ? !has : force;
        if (shouldHave && !has) this.classList.add(name);
        if (!shouldHave && has) this.classList.remove(name);
        return shouldHave;
      },
      contains: (name: string): boolean => read().includes(name),
    };
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'class') this._className = value;
    if (name === 'id') this.id = value;
    if (name === 'aria-label') this.ariaLabel = value;
    if (name === 'aria-disabled') this.ariaDisabled = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  ariaLabel = '';
  ariaDisabled = '';

  addEventListener(type: string, fn: (event: FakeEvent) => void, options?: boolean | { capture?: boolean }): void {
    const capture = typeof options === 'boolean' ? options : options?.capture === true;
    const list = this.listeners.get(type) ?? [];
    list.push({ fn, capture });
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: (event: FakeEvent) => void): void {
    const list = this.listeners.get(type);
    if (!list) return;
    this.listeners.set(
      type,
      list.filter((listener) => listener.fn !== fn)
    );
  }

  focus(): void {
    this.focusCount += 1;
    if (typeof document !== 'undefined') {
      (document as unknown as { activeElement: FakeElement | null }).activeElement = this;
    }
  }

  blur(): void {
    if (typeof document !== 'undefined') {
      (document as unknown as { activeElement: FakeElement | null }).activeElement = null;
    }
  }

  select(): void {
    this.focus();
  }

  querySelector(selector: string): FakeElement | null {
    const matches = (node: FakeElement): boolean => {
      if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
      return node.tagName === selector.toUpperCase();
    };
    const walk = (node: FakeNode): FakeElement | null => {
      for (const child of node.children) {
        if (child instanceof FakeElement) {
          if (matches(child)) return child;
          const nested = walk(child);
          if (nested) return nested;
        }
      }
      return null;
    };
    return walk(this);
  }

  get innerHTML(): string {
    return this.textContent;
  }

  set innerHTML(value: string) {
    this.replaceChildren();
    void value;
  }
}

type FakeDocument = {
  head: FakeElement;
  body: FakeElement;
  activeElement: FakeElement | null;
  createElement(tagName: string): FakeElement;
  createElementNS(_namespace: string, tagName: string): FakeElement;
  createTextNode(text: string): FakeText;
  getElementById(id: string): FakeElement | null;
  addEventListener(type: string, fn: (event: FakeEvent) => void, options?: boolean | { capture?: boolean }): void;
  removeEventListener(type: string, fn: (event: FakeEvent) => void): void;
};

export interface FakeDom {
  document: FakeDocument;
  window: {
    addEventListener(type: string, fn: (event: FakeEvent) => void, options?: boolean | { capture?: boolean }): void;
    removeEventListener(type: string, fn: (event: FakeEvent) => void): void;
    setTimeout(handler: () => void, timeout?: number): number;
    clearTimeout(handle: number): void;
  };
  click(element: FakeElement): void;
  dispatchKey(type: 'keydown' | 'keyup', key: string): FakeEvent;
  find(selector: string): FakeElement | null;
  findAll(selector: string): FakeElement[];
  uninstall(): void;
}

function createEvent(type: string, target: FakeElement, extra: Partial<FakeEvent> = {}): FakeEvent {
  const event: FakeEvent = {
    type,
    target,
    key: '',
    defaultPrevented: false,
    propagationStopped: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault(): void {
      event.defaultPrevented = true;
    },
    stopPropagation(): void {
      event.propagationStopped = true;
    },
    ...extra,
  };
  return event;
}

export function installFakeDom(): FakeDom {
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const save = (key: string): void => {
    saved.set(key, Object.getOwnPropertyDescriptor(globals, key));
  };
  const setGlobal = (key: string, value: unknown): void => {
    Object.defineProperty(globals, key, { value, writable: true, configurable: true, enumerable: true });
  };

  const doc: FakeDocument = {
    head,
    body,
    activeElement: null,
    createElement: (tagName: string) => new FakeElement(tagName),
    createElementNS: (_namespace: string, tagName: string) => new FakeElement(tagName),
    createTextNode: (text: string) => new FakeText(text),
    getElementById: (id: string) => {
      const findIn = (node: FakeNode): FakeElement | null => {
        for (const child of node.children) {
          if (child instanceof FakeElement) {
            if (child.id === id) return child;
            const nested = findIn(child);
            if (nested) return nested;
          }
        }
        return null;
      };
      return findIn(body) ?? findIn(head);
    },
    addEventListener: (type, fn, options) => {
      globalListeners.add(type, fn, options);
    },
    removeEventListener: (type, fn) => {
      globalListeners.remove(type, fn);
    },
  };
  head.parentNode = null;
  body.parentNode = null;

  const globalListeners = {
    map: new Map<string, Listener[]>(),
    add(type: string, fn: (event: FakeEvent) => void, options?: boolean | { capture?: boolean }): void {
      const capture = typeof options === 'boolean' ? options : options?.capture === true;
      const list = this.map.get(type) ?? [];
      list.push({ fn, capture });
      this.map.set(type, list);
    },
    remove(type: string, fn: (event: FakeEvent) => void): void {
      const list = this.map.get(type);
      if (!list) return;
      this.map.set(
        type,
        list.filter((listener) => listener.fn !== fn)
      );
    },
    dispatch(type: string, event: FakeEvent): void {
      const list = [...(this.map.get(type) ?? [])].sort((a, b) => Number(b.capture) - Number(a.capture));
      for (const listener of list) {
        if (event.propagationStopped) break;
        listener.fn(event);
      }
    },
  };

  const fakeWindow = {
    addEventListener: (type: string, fn: (event: FakeEvent) => void, options?: boolean | { capture?: boolean }): void => {
      globalListeners.add(type, fn, options);
    },
    removeEventListener: (type: string, fn: (event: FakeEvent) => void): void => {
      globalListeners.remove(type, fn);
    },
    setTimeout: (handler: () => void, timeout?: number): number => setTimeout(handler, timeout) as unknown as number,
    clearTimeout: (handle: number): void => clearTimeout(handle),
  };

  save('document');
  save('window');
  save('Node');
  save('HTMLElement');
  save('SVGElement');
  save('navigator');
  save('requestAnimationFrame');
  save('performance');
  setGlobal('document', doc);
  setGlobal('window', fakeWindow);
  setGlobal('Node', FakeNode);
  setGlobal('HTMLElement', FakeElement);
  setGlobal('SVGElement', FakeElement);
  setGlobal('navigator', {});
  setGlobal('requestAnimationFrame', (handler: () => void): number => setTimeout(handler, 0) as unknown as number);

  const collect = (root: FakeNode, predicate: (element: FakeElement) => boolean): FakeElement[] => {
    const found: FakeElement[] = [];
    for (const child of root.children) {
      if (child instanceof FakeElement) {
        if (predicate(child)) found.push(child);
        found.push(...collect(child, predicate));
      }
    }
    return found;
  };
  const predicateFor = (selector: string): ((element: FakeElement) => boolean) => {
    if (selector.startsWith('.')) return (element) => element.classList.contains(selector.slice(1));
    return (element) => element.tagName === selector.toUpperCase();
  };

  const dom: FakeDom = {
    document: doc,
    window: fakeWindow,
    click(element: FakeElement): void {
      const event = createEvent('click', element);
      let cursor: FakeNode | null = element;
      while (cursor) {
        if (cursor instanceof FakeElement) {
          const list = cursor.listeners.get('click') ?? [];
          for (const listener of list) {
            if (event.propagationStopped) break;
            listener.fn(event);
          }
        }
        cursor = cursor.parentNode;
      }
    },
    dispatchKey(type: 'keydown' | 'keyup', key: string): FakeEvent {
      const event = createEvent(type, body, { key });
      body.classList.contains('ui-hidden');
      globalListeners.dispatch(type, event);
      return event;
    },
    find(selector: string): FakeElement | null {
      const results = collect(body, predicateFor(selector));
      return results[0] ?? null;
    },
    findAll(selector: string): FakeElement[] {
      return collect(body, predicateFor(selector));
    },
    uninstall(): void {
      for (const [key, descriptor] of saved) {
        if (descriptor === undefined) delete globals[key];
        else Object.defineProperty(globals, key, descriptor);
      }
    },
  };
  return dom;
}
