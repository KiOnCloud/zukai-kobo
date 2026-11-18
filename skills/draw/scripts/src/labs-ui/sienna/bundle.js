/* @ds-bundle: {"format":4,"namespace":"Sienna","components":[{"name":"Button"},{"name":"Input"},{"name":"Select"},{"name":"Checkbox"},{"name":"Radio"},{"name":"Switch"},{"name":"Chip"},{"name":"Badge"},{"name":"Card"},{"name":"Alert"},{"name":"Tabs"},{"name":"Table"},{"name":"Menu"},{"name":"Dialog"},{"name":"Avatar"},{"name":"Tooltip"}]} */
/* Sienna — framework-free helpers over the .sn-* class contract in bundle.css.
   Each function returns a DOM element (Dialog returns a controller). Angular apps use the classes directly. */
(function () {
  'use strict';

  var ICON_PATHS = {
    'arrow-up': 'M12 19V5M5 12l7-7 7 7',
    'arrow-right': 'M5 12h14M13 5l7 7-7 7',
    'plus': 'M12 5v14M5 12h14',
    'check': 'M5 12.5l4.5 4.5L19 7.5',
    'close': 'M6 6l12 12M18 6L6 18',
    'chevron-down': 'M6 9l6 6 6-6',
    'chevron-right': 'M9 6l6 6-6 6',
    'search': 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
    'info': 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v5M12 8h.01',
    'alert': 'M12 4l9 16H3l9-16zM12 10v4M12 17h.01',
    'circle-check': 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM8.5 12.5l2.5 2.5 4.5-5',
    'edit': 'M4 20h4l10.5-10.5a2 2 0 0 0-3-3L5 17v3zM13 7l3 3',
    'trash': 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
    'download': 'M12 4v12M6 11l6 6 6-6M4 20h16',
    'settings': 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM19 12l2-1-1.5-3.5-2.2.4a7 7 0 0 0-1.7-1L15 4.5h-6l-.6 2.4a7 7 0 0 0-1.7 1L4.5 7.5 3 11l2 1-2 1 1.5 3.5 2.2-.4a7 7 0 0 0 1.7 1L9 19.5h6l.6-2.4a7 7 0 0 0 1.7-1l2.2.4L21 13l-2-1z',
    'user': 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 20a8 8 0 0 1 16 0',
    'menu': 'M4 7h16M4 12h16M4 17h16',
    'more': 'M5 12h.01M12 12h.01M19 12h.01',
    'external': 'M14 4h6v6M20 4l-9 9M18 13v6H5V6h6'
  };

  function icon(name, size) {
    var d = ICON_PATHS[name] || ICON_PATHS.info;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'sn-icon' + (size === 'sm' ? ' sn-icon-sm' : ''));
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'readOnly' || k === 'indeterminate') node[k] = v;
        else if (k === 'value') node.value = v;
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function cx() {
    return Array.prototype.slice.call(arguments).filter(Boolean).join(' ');
  }

  var uid = 0;
  function nextId(prefix) { uid += 1; return (prefix || 'sn') + '-' + uid; }

  /* ---------- Button ---------- */
  function Button(p) {
    p = p || {};
    var classes = cx('sn-btn', p.variant && p.variant !== 'secondary' && 'sn-btn-' + p.variant, p.size && p.size !== 'md' && 'sn-btn-' + p.size,
      p.iconOnly && 'sn-btn-icon', p.round && 'sn-btn-round', p.square && 'sn-btn-square', p.block && 'sn-btn-block', p.className);
    var children = [];
    if (p.loading) children.push(el('span', { class: 'sn-spinner', 'aria-hidden': 'true' }));
    else if (p.icon) children.push(icon(p.icon));
    if (!p.iconOnly && p.label) children.push(p.label);
    if (p.iconEnd && !p.iconOnly) children.push(icon(p.iconEnd));
    var attrs = { class: classes, type: p.href ? null : (p.type || 'button'), disabled: !!p.disabled || !!p.loading,
      'aria-label': p.iconOnly ? p.label : null, 'aria-busy': p.loading ? 'true' : null, onClick: p.onClick, href: p.href };
    return el(p.href ? 'a' : 'button', attrs, children);
  }

  /* ---------- Field wrappers ---------- */
  function field(p, control, id) {
    var kids = [];
    if (p.label) kids.push(el('label', { class: 'sn-label', for: id }, [p.label, p.optional ? el('span', { class: 'sn-label-optional', text: ' (optional)' }) : null]));
    kids.push(control);
    if (p.error) kids.push(el('div', { class: 'sn-error', id: id + '-error', role: 'alert' }, [icon('alert', 'sm'), p.error]));
    else if (p.helper) kids.push(el('div', { class: 'sn-help', id: id + '-help', text: p.helper }));
    return el('div', { class: cx('sn-field', p.className) }, kids);
  }

  function Input(p) {
    p = p || {};
    var id = p.id || nextId('input');
    var tag = p.multiline ? 'textarea' : 'input';
    var control = el(tag, { class: cx('sn-input', p.size && p.size !== 'md' && 'sn-input-' + p.size), id: id, type: p.multiline ? null : (p.type || 'text'),
      placeholder: p.placeholder, value: p.value, disabled: !!p.disabled, readOnly: !!p.readOnly, required: !!p.required, rows: p.multiline ? (p.rows || 4) : null,
      'aria-invalid': p.error ? 'true' : null, 'aria-describedby': p.error ? id + '-error' : (p.helper ? id + '-help' : null), onInput: p.onInput, name: p.name });
    return field(p, control, id);
  }

  function Select(p) {
    p = p || {};
    var id = p.id || nextId('select');
    var options = (p.options || []).map(function (o) {
      var opt = typeof o === 'string' ? { value: o, label: o } : o;
      return el('option', { value: opt.value, selected: opt.value === p.value, disabled: !!opt.disabled, text: opt.label });
    });
    if (p.placeholder) options.unshift(el('option', { value: '', selected: !p.value, disabled: true, text: p.placeholder }));
    var select = el('select', { class: cx('sn-input', p.size && p.size !== 'md' && 'sn-input-' + p.size), id: id, disabled: !!p.disabled,
      'aria-invalid': p.error ? 'true' : null, 'aria-describedby': p.error ? id + '-error' : (p.helper ? id + '-help' : null), onChange: p.onChange, name: p.name }, options);
    return field(p, el('div', { class: 'sn-select-wrap' }, [select]), id);
  }

  /* ---------- Choices ---------- */
  function choice(kind, p) {
    p = p || {};
    var id = p.id || nextId(kind);
    var input = el('input', { class: 'sn-' + kind, type: kind, id: id, name: p.name, value: p.value, checked: !!p.checked, disabled: !!p.disabled,
      indeterminate: kind === 'checkbox' && !!p.indeterminate, 'aria-invalid': p.invalid ? 'true' : null, onChange: p.onChange });
    var text = [p.label];
    if (p.description) text.push(el('span', { class: 'sn-help', text: p.description }));
    return el('label', { class: cx('sn-choice', p.className), for: id }, [input, el('span', null, text)]);
  }
  function Checkbox(p) { return choice('checkbox', p); }
  function Radio(p) {
    p = p || {};
    if (!p.options) return choice('radio', p);
    var name = p.name || nextId('radio');
    var items = p.options.map(function (o) {
      var opt = typeof o === 'string' ? { value: o, label: o } : o;
      return choice('radio', { name: name, value: opt.value, label: opt.label, description: opt.description, checked: opt.value === p.value, disabled: !!opt.disabled || !!p.disabled, onChange: p.onChange });
    });
    var group = el('div', { class: cx('sn-stack', p.className), role: 'radiogroup', 'aria-label': p.label });
    group.style.gap = 'var(--space-2)';
    items.forEach(function (i) { group.appendChild(i); });
    return group;
  }
  function Switch(p) {
    p = p || {};
    var id = p.id || nextId('switch');
    var input = el('input', { type: 'checkbox', role: 'switch', id: id, checked: !!p.checked, disabled: !!p.disabled, 'aria-checked': p.checked ? 'true' : 'false', onChange: function (e) {
      e.target.setAttribute('aria-checked', e.target.checked ? 'true' : 'false'); if (p.onChange) p.onChange(e);
    } });
    var kids = [input, el('span', { class: 'sn-switch-track', 'aria-hidden': 'true' })];
    if (p.label) kids.push(el('span', { text: p.label }));
    return el('label', { class: cx('sn-switch', p.className), for: id }, kids);
  }

  /* ---------- Chip, Badge ---------- */
  function Chip(p) {
    p = p || {};
    var kids = [];
    if (p.icon) kids.push(icon(p.icon, 'sm'));
    kids.push(p.label);
    if (p.onRemove) kids.push(el('button', { class: 'sn-chip-remove', type: 'button', 'aria-label': 'Remove ' + p.label, onClick: function (e) { e.stopPropagation(); p.onRemove(e); } }, [icon('close', 'sm')]));
    return el('button', { class: cx('sn-chip', p.className), type: 'button', 'aria-pressed': p.selectable ? (p.selected ? 'true' : 'false') : null,
      'data-selected': !p.selectable && p.selected ? 'true' : null, disabled: !!p.disabled, onClick: function (e) {
        if (p.selectable) e.currentTarget.setAttribute('aria-pressed', e.currentTarget.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
        if (p.onClick) p.onClick(e);
      } }, kids);
  }
  function Badge(p) {
    p = p || {};
    return el('span', { class: cx('sn-badge', p.tone && p.tone !== 'neutral' && 'sn-badge-' + p.tone, p.dot && 'sn-badge-dot', p.pill && 'sn-badge-pill', p.outline && 'sn-badge-outline', p.className), text: p.label });
  }

  /* ---------- Card, Alert ---------- */
  function Card(p) {
    p = p || {};
    var kids = [];
    if (p.eyebrow) kids.push(el('div', { class: 'eyebrow', text: p.eyebrow, style: 'margin-bottom: var(--space-2)' }));
    if (p.title || p.action) kids.push(el('div', { class: 'sn-card-header' }, [el('div', { class: 'sn-card-title', text: p.title }), p.action || null]));
    if (p.body) kids.push(typeof p.body === 'string' ? el('div', { class: 'sn-card-body', text: p.body }) : p.body);
    if (p.actions && p.actions.length) kids.push(el('div', { class: 'sn-card-footer' }, p.actions));
    var tag = p.href ? 'a' : 'div';
    return el(tag, { class: cx('sn-card', p.variant === 'feature' && 'sn-card-feature', p.variant === 'flat' && 'sn-card-flat', p.compact && 'sn-card-compact',
      p.tint && 'sn-card-' + p.tint, p.href && 'sn-card-link', p.className), href: p.href }, kids);
  }
  var ALERT_ICON = { info: 'info', success: 'circle-check', warning: 'alert', danger: 'alert', clay: 'info', neutral: 'info' };
  function Alert(p) {
    p = p || {};
    var tone = p.tone || 'neutral';
    var text = [];
    if (p.title) text.push(el('div', { class: 'sn-alert-title', text: p.title }));
    if (p.body) text.push(el('div', { class: 'sn-alert-body', text: p.body }));
    if (p.actions && p.actions.length) text.push(el('div', { class: 'sn-alert-actions' }, p.actions));
    var kids = [icon(ALERT_ICON[tone] || 'info'), el('div', { style: 'flex: 1 1 auto; min-width: 0' }, text)];
    var alert = el('div', { class: cx('sn-alert', tone !== 'neutral' && 'sn-alert-' + tone, p.className), role: tone === 'danger' || tone === 'warning' ? 'alert' : 'status' }, kids);
    if (p.dismissible) alert.appendChild(Button({ variant: 'ghost', size: 'sm', iconOnly: true, icon: 'close', label: 'Dismiss', className: 'sn-alert-dismiss', onClick: function () { alert.remove(); if (p.onDismiss) p.onDismiss(); } }));
    return alert;
  }

  /* ---------- Tabs ---------- */
  function Tabs(p) {
    p = p || {};
    var items = p.items || [];
    var current = p.value || (items[0] && items[0].value);
    var list = el('div', { class: cx('sn-tabs', p.variant === 'segment' && 'sn-tabs-segment', p.className), role: 'tablist', 'aria-label': p.label });
    var panel = p.panel !== false ? el('div', { class: 'sn-tabpanel', role: 'tabpanel' }) : null;
    function render() {
      list.innerHTML = '';
      items.forEach(function (it) {
        var kids = [];
        if (it.icon) kids.push(icon(it.icon, 'sm'));
        kids.push(it.label);
        if (it.count !== undefined) kids.push(Badge({ label: String(it.count), tone: it.value === current ? 'clay' : 'neutral' }));
        list.appendChild(el('button', { class: 'sn-tab', type: 'button', role: 'tab', 'aria-selected': it.value === current ? 'true' : 'false', tabindex: it.value === current ? '0' : '-1', disabled: !!it.disabled,
          onClick: function () { current = it.value; render(); if (p.onChange) p.onChange(it.value); } }, kids));
      });
      if (panel) { var it = items.filter(function (i) { return i.value === current; })[0]; panel.textContent = (it && it.content) || ''; }
    }
    list.addEventListener('keydown', function (e) {
      var idx = items.findIndex(function (i) { return i.value === current; });
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        var next = items[(idx + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
        current = next.value; render(); list.querySelector('[aria-selected="true"]').focus(); if (p.onChange) p.onChange(current); e.preventDefault();
      }
    });
    render();
    return panel ? el('div', null, [list, panel]) : list;
  }

  /* ---------- Table ---------- */
  function Table(p) {
    p = p || {};
    var cols = p.columns || [];
    var head = el('tr', null, cols.map(function (c) { return el('th', { class: cx(c.numeric && 'sn-table-numeric'), scope: 'col', text: c.label }); }));
    var rows = (p.rows || []).map(function (r, i) {
      return el('tr', { 'aria-selected': p.selected && p.selected.indexOf(i) >= 0 ? 'true' : null }, cols.map(function (c) {
        var v = typeof c.render === 'function' ? c.render(r) : r[c.key];
        return el('td', { class: cx(c.numeric && 'sn-table-numeric', c.muted && 'sn-table-muted') }, [typeof v === 'string' || typeof v === 'number' ? String(v) : v]);
      }));
    });
    var table = el('table', { class: cx('sn-table', p.dense && 'sn-table-dense') }, [p.caption ? el('caption', { text: p.caption }) : null, el('thead', null, [head]), el('tbody', null, rows)]);
    return el('div', { class: cx('sn-table-wrap', p.className) }, [table]);
  }

  /* ---------- Menu ---------- */
  function Menu(p) {
    p = p || {};
    var kids = (p.items || []).map(function (it) {
      if (it === '-' || it.type === 'separator') return el('hr', { class: 'sn-menu-sep', role: 'separator' });
      if (it.type === 'label') return el('div', { class: 'sn-menu-label', role: 'presentation', text: it.label });
      var c = [];
      if (it.icon) c.push(icon(it.icon));
      c.push(it.label);
      if (it.hint) c.push(el('span', { class: 'sn-menu-hint', text: it.hint }));
      return el(it.href ? 'a' : 'button', { class: cx('sn-menu-item', it.danger && 'sn-menu-item-danger'), type: it.href ? null : 'button', href: it.href, role: it.checked !== undefined ? 'menuitemradio' : 'menuitem',
        'aria-checked': it.checked !== undefined ? (it.checked ? 'true' : 'false') : null, disabled: !!it.disabled, onClick: it.onClick }, c);
    });
    return el('div', { class: cx('sn-menu', p.className), role: 'menu', 'aria-label': p.label }, kids);
  }

  /* ---------- Dialog ---------- */
  function Dialog(p) {
    p = p || {};
    var scrim = el('div', { class: 'sn-scrim', hidden: true });
    var titleId = nextId('dialog-title');
    var kids = [el('h2', { class: 'sn-dialog-title', id: titleId, text: p.title })];
    if (p.body) kids.push(typeof p.body === 'string' ? el('div', { class: 'sn-dialog-body', text: p.body }) : el('div', { class: 'sn-dialog-body' }, [p.body]));
    if (p.actions && p.actions.length) kids.push(el('div', { class: 'sn-dialog-actions' }, p.actions));
    var box = el('div', { class: cx('sn-dialog', p.sheet && 'sn-dialog-sheet', p.className), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' }, kids);
    scrim.appendChild(box);
    var lastFocus = null;
    function close() { scrim.hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); if (p.onClose) p.onClose(); }
    function open() { lastFocus = document.activeElement; scrim.hidden = false; var f = box.querySelector('button, [href], input, select, textarea'); (f || box).focus(); }
    scrim.addEventListener('click', function (e) { if (e.target === scrim && p.dismissible !== false) close(); });
    box.addEventListener('keydown', function (e) { if (e.key === 'Escape' && p.dismissible !== false) close(); });
    (p.mount || document.body).appendChild(scrim);
    return { element: scrim, open: open, close: close };
  }

  /* ---------- Avatar, Tooltip ---------- */
  function initials(name) {
    return String(name || '').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
  }
  function Avatar(p) {
    p = p || {};
    var kids = p.src ? [el('img', { src: p.src, alt: p.name || '' })] : [initials(p.name)];
    return el('span', { class: cx('sn-avatar', p.size && p.size !== 'md' && 'sn-avatar-' + p.size, p.tone && 'sn-avatar-' + p.tone, p.className), role: p.src ? null : 'img', 'aria-label': p.src ? null : p.name, title: p.name }, kids);
  }
  function Tooltip(p) {
    p = p || {};
    var id = nextId('tip');
    var target = p.target;
    if (target && target.setAttribute) target.setAttribute('aria-describedby', id);
    return el('span', { class: cx('sn-tooltip', p.className) }, [target, el('span', { class: 'sn-tooltip-bubble', role: 'tooltip', id: id, text: p.text })]);
  }

  var api = { icon: icon, el: el, Button: Button, Input: Input, Select: Select, Checkbox: Checkbox, Radio: Radio, Switch: Switch, Chip: Chip, Badge: Badge,
    Card: Card, Alert: Alert, Tabs: Tabs, Table: Table, Menu: Menu, Dialog: Dialog, Avatar: Avatar, Tooltip: Tooltip, icons: Object.keys(ICON_PATHS) };
  window.Sienna = window.Sienna || {};
  Object.assign(window.Sienna, api);
})();
