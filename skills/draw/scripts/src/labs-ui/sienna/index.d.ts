/**
 * Sienna — framework-free helpers over the `.sn-*` class contract (components/bundle.css).
 * Every helper returns a DOM element built from the classes; Angular apps bind the classes directly
 * (see the "Consuming from Angular" section) and only use these helpers in plain pages and previews.
 */

export type IconName =
  | 'arrow-up' | 'arrow-right' | 'plus' | 'check' | 'close' | 'chevron-down' | 'chevron-right' | 'search'
  | 'info' | 'alert' | 'circle-check' | 'edit' | 'trash' | 'download' | 'settings' | 'user' | 'menu' | 'more' | 'external';

/** A 24-grid stroke icon in `currentColor` (`.sn-icon`, 20px; `size: 'sm'` → 16px). */
export declare function icon(name: IconName, size?: 'sm' | 'md'): SVGSVGElement;

export interface ButtonProps {
  label?: string;
  /** `secondary` (default): outlined on surface-000. `primary`: inverse ink, once per view. `accent`: clay, the brand's own moment. `ghost`: no border. `danger`: destructive. `link`: inline text. */
  variant?: 'primary' | 'secondary' | 'accent' | 'ghost' | 'danger' | 'link';
  /** control-sm 32px · control-md 36px (default) · control-lg 44px */
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconEnd?: IconName;
  /** Square icon button; `label` becomes the aria-label. */
  iconOnly?: boolean;
  /** radius-full — the submit disc (`accent` + `round` + `iconOnly`). */
  round?: boolean;
  /** radius-none — marketing pages only. */
  square?: boolean;
  block?: boolean;
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  /** Renders an `<a class="sn-btn">`. */
  href?: string;
  onClick?: (e: MouseEvent) => void;
  className?: string;
}
export declare function Button(props: ButtonProps): HTMLButtonElement | HTMLAnchorElement;

export interface FieldProps {
  label?: string;
  optional?: boolean;
  helper?: string;
  /** Sets `aria-invalid`, a `danger` border and the message with an icon. */
  error?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
}
export interface InputProps extends FieldProps {
  type?: 'text' | 'email' | 'password' | 'search' | 'number' | 'tel' | 'url' | 'date';
  placeholder?: string;
  value?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Renders a `<textarea class="sn-input">`. */
  multiline?: boolean;
  rows?: number;
  readOnly?: boolean;
  required?: boolean;
  onInput?: (e: InputEvent) => void;
}
/** `.sn-field` > `.sn-label` + `.sn-input` + `.sn-help` | `.sn-error` */
export declare function Input(props: InputProps): HTMLDivElement;

export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectProps extends FieldProps {
  options: Array<string | SelectOption>;
  value?: string;
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
  onChange?: (e: Event) => void;
}
/** Native `<select class="sn-input">` inside `.sn-select-wrap` (draws the chevron). */
export declare function Select(props: SelectProps): HTMLDivElement;

export interface ChoiceProps {
  label: string;
  description?: string;
  name?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  onChange?: (e: Event) => void;
  className?: string;
}
export interface CheckboxProps extends ChoiceProps { indeterminate?: boolean }
/** `<label class="sn-choice"><input class="sn-checkbox"> …` */
export declare function Checkbox(props: CheckboxProps): HTMLLabelElement;
export interface RadioGroupProps {
  label?: string;
  name?: string;
  options: Array<string | { value: string; label: string; description?: string; disabled?: boolean }>;
  value?: string;
  disabled?: boolean;
  onChange?: (e: Event) => void;
  className?: string;
}
/** One radio (`ChoiceProps`) or a whole group (`RadioGroupProps`, `role="radiogroup"`). */
export declare function Radio(props: ChoiceProps | RadioGroupProps): HTMLElement;
export interface SwitchProps { label?: string; checked?: boolean; disabled?: boolean; id?: string; onChange?: (e: Event) => void; className?: string }
/** `<label class="sn-switch"><input type="checkbox" role="switch"><span class="sn-switch-track">` */
export declare function Switch(props: SwitchProps): HTMLLabelElement;

export interface ChipProps {
  label: string;
  icon?: IconName;
  /** Toggle chip: `aria-pressed` flips on click; selected = clay-soft ground + clay-text. */
  selectable?: boolean;
  selected?: boolean;
  /** Adds the × and calls back; for filter chips. */
  onRemove?: (e: MouseEvent) => void;
  disabled?: boolean;
  onClick?: (e: MouseEvent) => void;
  className?: string;
}
export declare function Chip(props: ChipProps): HTMLButtonElement;

export interface BadgeProps {
  label: string;
  /** neutral (default) · clay · success · danger · warning · info · inverse */
  tone?: 'neutral' | 'clay' | 'success' | 'danger' | 'warning' | 'info' | 'inverse';
  dot?: boolean;
  pill?: boolean;
  outline?: boolean;
  className?: string;
}
export declare function Badge(props: BadgeProps): HTMLSpanElement;

export interface CardProps {
  title?: string;
  eyebrow?: string;
  body?: string | HTMLElement;
  /** Placed in the header, right of the title (a Button or Badge). */
  action?: HTMLElement;
  /** Footer buttons, primary last. */
  actions?: HTMLElement[];
  /** default: surface-000 + border · feature: manilla, radius-xl, serif title · flat: surface-200, no border */
  variant?: 'default' | 'feature' | 'flat';
  /** Feature-card ground: manilla (default) · kraft · cactus · heather */
  tint?: 'kraft' | 'cactus' | 'heather';
  compact?: boolean;
  /** Renders as `<a class="sn-card sn-card-link">`. */
  href?: string;
  className?: string;
}
export declare function Card(props: CardProps): HTMLElement;

export interface AlertProps {
  title?: string;
  body?: string;
  /** neutral (default, surface-200) · info · success · warning · danger · clay */
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'clay';
  actions?: HTMLElement[];
  dismissible?: boolean;
  onDismiss?: () => void;
  className?: string;
}
export declare function Alert(props: AlertProps): HTMLDivElement;

export interface TabItem { value: string; label: string; icon?: IconName; count?: number; content?: string; disabled?: boolean }
export interface TabsProps {
  items: TabItem[];
  value?: string;
  /** underline (default) · segment: a segmented control on surface-200 */
  variant?: 'underline' | 'segment';
  label?: string;
  /** false: render only the tablist (you own the panel). */
  panel?: boolean;
  onChange?: (value: string) => void;
  className?: string;
}
export declare function Tabs(props: TabsProps): HTMLElement;

export interface TableColumn<Row = Record<string, unknown>> {
  key: string;
  label: string;
  numeric?: boolean;
  muted?: boolean;
  render?: (row: Row) => string | number | HTMLElement;
}
export interface TableProps<Row = Record<string, unknown>> {
  columns: TableColumn<Row>[];
  rows: Row[];
  caption?: string;
  /** Row indexes rendered with `aria-selected`. */
  selected?: number[];
  dense?: boolean;
  className?: string;
}
/** `.sn-table-wrap` > `table.sn-table`; numeric columns get tabular figures and right alignment. */
export declare function Table<Row = Record<string, unknown>>(props: TableProps<Row>): HTMLDivElement;

export type MenuItem =
  | '-'
  | { type: 'separator' }
  | { type: 'label'; label: string }
  | { label: string; icon?: IconName; hint?: string; href?: string; checked?: boolean; danger?: boolean; disabled?: boolean; onClick?: (e: MouseEvent) => void };
export interface MenuProps { items: MenuItem[]; label?: string; className?: string }
/** `.sn-menu` with `role="menu"`; positioning is the caller's (CDK Overlay in Angular). */
export declare function Menu(props: MenuProps): HTMLDivElement;

export interface DialogProps {
  title: string;
  body?: string | HTMLElement;
  actions?: HTMLElement[];
  /** Bottom sheet on small screens. */
  sheet?: boolean;
  /** false: no close on scrim click or Escape. */
  dismissible?: boolean;
  mount?: HTMLElement;
  onClose?: () => void;
  className?: string;
}
export interface DialogController { element: HTMLDivElement; open(): void; close(): void }
/** Appends `.sn-scrim > .sn-dialog` to `mount` (body) hidden; `open()` shows it and moves focus in. */
export declare function Dialog(props: DialogProps): DialogController;

export interface AvatarProps {
  name?: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** kraft (default) · clay · sky · olive · fig · heather — ink text on every one */
  tone?: 'clay' | 'sky' | 'olive' | 'fig' | 'heather';
  className?: string;
}
export declare function Avatar(props: AvatarProps): HTMLSpanElement;

export interface TooltipProps { target: HTMLElement; text: string; className?: string }
/** Wraps `target` in `.sn-tooltip` with a `role="tooltip"` bubble shown on hover and focus. */
export declare function Tooltip(props: TooltipProps): HTMLSpanElement;

export declare const icons: IconName[];

declare global {
  interface Window {
    Sienna: {
      icon: typeof icon; Button: typeof Button; Input: typeof Input; Select: typeof Select; Checkbox: typeof Checkbox; Radio: typeof Radio;
      Switch: typeof Switch; Chip: typeof Chip; Badge: typeof Badge; Card: typeof Card; Alert: typeof Alert; Tabs: typeof Tabs; Table: typeof Table;
      Menu: typeof Menu; Dialog: typeof Dialog; Avatar: typeof Avatar; Tooltip: typeof Tooltip; icons: IconName[];
    };
  }
}
