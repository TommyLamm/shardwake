// DOM 小工具（M1-14）：建立元素、只在值改變時寫入 DOM 的快取寫入器。
// HUD 每畫面都會呼叫 update，但只有值真的變了才碰 DOM（避免每畫面大量寫入與版面重排）；
// 數值條與環用 transform／stroke-dashoffset（不觸發版面計算）。

export type Child = Node | string | null | undefined | false;

export interface ElementProps {
  class?: string;
  text?: string;
  attrs?: Readonly<Record<string, string>>;
  dataset?: Readonly<Record<string, string>>;
  /** 點擊（click）處理。 */
  onClick?: (e: MouseEvent) => void;
  hidden?: boolean;
}

/** 建立元素：h('div', { class: 'x', text: '…' }, [child, …])。 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  if (props.dataset) for (const [k, v] of Object.entries(props.dataset)) el.dataset[k] = v;
  if (props.onClick) el.addEventListener('click', props.onClick as EventListener);
  if (props.hidden) el.hidden = true;
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Readonly<Record<string, string>> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** 文字寫入器：只在文字改變時寫入 textContent。 */
export class TextSlot {
  private last: string | null = null;
  writes = 0;
  constructor(readonly el: HTMLElement | SVGElement) {}
  set(text: string): void {
    if (text === this.last) return;
    this.last = text;
    this.el.textContent = text;
    this.writes++;
  }
}

/** 可見性寫入器（hidden 屬性）。 */
export class VisibleSlot {
  private last: boolean | null = null;
  constructor(readonly el: HTMLElement) {}
  set(visible: boolean): void {
    if (visible === this.last) return;
    this.last = visible;
    this.el.hidden = !visible;
  }
}

/** class 切換寫入器。 */
export class ClassSlot {
  private last: boolean | null = null;
  constructor(
    readonly el: Element,
    readonly cls: string,
  ) {}
  set(on: boolean): void {
    if (on === this.last) return;
    this.last = on;
    this.el.classList.toggle(this.cls, on);
  }
}

/** data-* 屬性寫入器。 */
export class DataSlot {
  private last: string | null = null;
  constructor(
    readonly el: HTMLElement,
    readonly name: string,
  ) {}
  set(value: string): void {
    if (value === this.last) return;
    this.last = value;
    this.el.dataset[this.name] = value;
  }
}

/** 樣式屬性寫入器（CSS 變數或一般屬性）；數值量化到 precision 以下的變化不寫入。 */
export class StyleSlot {
  private last = Number.NaN;
  private lastText: string | null = null;
  constructor(
    readonly el: HTMLElement | SVGElement,
    readonly prop: string,
    readonly format: (v: number) => string = (v) => String(v),
    readonly precision = 0.001,
  ) {}
  set(value: number): void {
    if (Math.abs(value - this.last) < this.precision) return;
    this.last = value;
    const text = this.format(value);
    if (text === this.lastText) return;
    this.lastText = text;
    this.el.style.setProperty(this.prop, text);
  }
}

/** 水平數值條：fill 以 transform: scaleX(fraction) 表示（transform-origin 在左）。 */
export function scaleXSlot(el: HTMLElement): StyleSlot {
  return new StyleSlot(el, 'transform', (v) => `scaleX(${v.toFixed(4)})`, 0.0005);
}
