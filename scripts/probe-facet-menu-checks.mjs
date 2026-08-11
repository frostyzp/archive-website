/**
 * The grid's two filter surfaces, side by side: the phone bar's CATEGORY /
 * LOCATION dropdowns (role="menu", compact widths only) and the desktop rail's
 * Category / Location checkbox accordions. For each surface it reads the row's
 * text colour at rest / hovered / checked, the mark's border + ink, the panel
 * fill, and shoots them at 3x — so "the dropdown matches the sidebar" can be
 * judged off numbers rather than by eye.
 *
 * Also exercises what the redesign could break: aria-checked tracking, the grid
 * actually filtering, and the EXPLORE category flight (checkbox fade → words in
 * the air → dial), which reads [role="menuitemcheckbox"] off the rail.
 *
 * TAG=before|after names the shots. Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const TAG = process.env.TAG || 'before';
const PORT = Number(process.env.PORT || 9391);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/facet-menu-checks-profile-${PORT}`,
  '--window-size=1440,900',
  '--force-device-scale-factor=1',
  'about:blank',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p) return p;
    } catch {}
    await sleep(100);
  }
  throw new Error('no devtools target');
}

const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r?.exceptionDetails) return { error: r.exceptionDetails.text, detail: r.exceptionDetails.exception?.description };
  return r?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');

const setViewport = (width, height) =>
  send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

const shot = async (clip, file) => {
  const s = await send('Page.captureScreenshot', { format: 'png', clip });
  if (!s?.data) return null;
  fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
  return { file, data: s.data };
};

const hover = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  await sleep(320);
};

/* Reads one checkbox-ish row: its own colour, the mark's border + ink, and the
   drawn checkmark's stroke. `pathDrawn` is the visible fraction of the tick, so
   a "checked" row can be shown to actually carry a mark. */
const ROW_READER = `(row) => {
  const round = (n) => Math.round(n * 100) / 100;
  const cs = getComputedStyle(row);
  const box = row.querySelector('.facet-checkbox-box') || row.querySelector('[aria-hidden="true"]');
  const bcs = box ? getComputedStyle(box) : null;
  const bb = box ? box.getBoundingClientRect() : null;
  const path = row.querySelector('path');
  const pcs = path ? getComputedStyle(path) : null;
  let pathDrawn = null;
  if (path) {
    const len = path.getTotalLength();
    const dash = pcs.strokeDasharray;
    const first = dash && dash !== 'none' ? parseFloat(dash) : null;
    pathDrawn = first == null || !len ? 1 : round(first / len);
  }
  const r = row.getBoundingClientRect();
  return {
    label: (row.textContent || '').trim(),
    role: row.getAttribute('role'),
    ariaChecked: row.getAttribute('aria-checked'),
    ariaDisabled: row.getAttribute('aria-disabled'),
    disabled: row.disabled === true,
    tabbable: !row.disabled,
    classes: row.className,
    rowColor: cs.color,
    rowBackground: cs.backgroundColor,
    rowPadding: cs.padding,
    rowGap: cs.gap,
    rowLetterSpacing: cs.letterSpacing,
    rowFontSize: cs.fontSize,
    rowBox: { w: round(r.width), h: round(r.height) },
    mark: box
      ? {
          tag: box.tagName.toLowerCase(),
          cls: box.className,
          size: bb ? round(bb.width) + 'x' + round(bb.height) : null,
          borderRadius: bcs.borderRadius,
          borderColor: bcs.borderTopColor,
          borderWidth: bcs.borderTopWidth,
          color: bcs.color,
          background: bcs.backgroundColor,
          hasSvgTick: !!path,
        }
      : null,
    tick: path ? { stroke: pcs.stroke, strokeWidth: pcs.strokeWidth, opacity: pcs.opacity, pathDrawn } : null,
  };
};`;

const out = { tag: TAG, shots: [], desktopSidebar: {}, phoneMenu: {}, filtering: {}, flight: {}, notes: [] };

/* ── A. desktop rail (>760px): the sidebar's checkbox list ─────────────── */
await setViewport(1440, 900);
await send('Page.navigate', { url: `${BASE}/?view=grid` });
out.desktopSidebar.ready = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 150; i++) {
    if (document.querySelectorAll('.facet-checkbox-row').length) break;
    await sleep(200);
  }
  await sleep(2400);
  return document.querySelectorAll('.facet-checkbox-row').length;
})()`);

const READ_SIDEBAR = `(() => {
  const read = ${ROW_READER}
  const groups = [...document.querySelectorAll('[role="group"]')];
  const cat = groups.find((g) => (g.getAttribute('aria-label') || '').toLowerCase() === 'category');
  const rows = cat ? [...cat.querySelectorAll('.facet-checkbox-row')] : [];
  const r = cat ? cat.getBoundingClientRect() : null;
  // What the rail's rows actually sit on, for judging the dropdown's panel fill
  // against: the first painted ancestor background above them.
  let backdrop = null;
  for (let el = cat; el && !backdrop; el = el.parentElement) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') backdrop = { bg, on: el.className || el.tagName };
  }
  return {
    backdrop,
    rows: rows.map(read),
    clip: r ? { x: Math.round(r.left) - 6, y: Math.round(r.top) - 6, width: Math.round(r.width) + 12, height: Math.round(r.height) + 12, scale: 3 } : null,
    hoverPoint: rows[1] ? (() => { const b = rows[1].getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), label: (rows[1].textContent || '').trim() }; })() : null,
  };
})()`;

const sb = await evaluate(READ_SIDEBAR);
out.desktopSidebar.rest = sb.rows;
out.desktopSidebar.backdrop = sb.backdrop;
if (sb.clip) {
  const s = await shot(sb.clip, `/tmp/facet-${TAG}-sidebar-category.png`);
  if (s) out.shots.push(s.file);
  out.desktopSidebar.shotB64 = s?.data || null;
}

// Hover the second row (the first real category) and re-read just that row.
if (sb.hoverPoint) {
  await hover(sb.hoverPoint.x, sb.hoverPoint.y);
  out.desktopSidebar.hovered = await evaluate(`(() => {
    const read = ${ROW_READER}
    const rows = [...document.querySelectorAll('[role="group"][aria-label="Category"] .facet-checkbox-row')];
    return rows[1] ? read(rows[1]) : null;
  })()`);
  await hover(4, 4);
}

// Check one sidebar row so a "checked" reading (and a drawn mark) exists here too.
out.desktopSidebar.checked = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  const read = ${ROW_READER}
  const rows = [...document.querySelectorAll('[role="group"][aria-label="Category"] .facet-checkbox-row')];
  const row = rows[1];
  if (!row) return null;
  row.click();
  await sleep(600);
  return read(row);
})()`);
{
  const sbc = await evaluate(READ_SIDEBAR);
  if (sbc?.clip) {
    const s = await shot(sbc.clip, `/tmp/facet-${TAG}-sidebar-category-checked.png`);
    if (s) out.shots.push(s.file);
    out.desktopSidebar.checkedShotB64 = s?.data || null;
  }
  // Back to unfiltered before the flight so the rail carries every category.
  await evaluate(`(async () => {
    const sleep = (m) => new Promise(r => setTimeout(r, m));
    const rows = [...document.querySelectorAll('[role="group"][aria-label="Category"] .facet-checkbox-row')];
    rows[1].click();
    await sleep(600);
    return rows[1].getAttribute('aria-checked');
  })()`);
}

/* ── B. flight: EXPLORE with the rail standing (desktop only) ─────────── */
const FLIGHT = `(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  const round = (n) => Math.round(n * 100) / 100;
  const boxOpacity = () => {
    const rows = [...document.querySelectorAll('[role="group"][aria-label="Category"] .facet-checkbox-row')];
    return rows.map((r) => {
      const b = r.querySelector('.facet-checkbox-box');
      return b ? round(parseFloat(getComputedStyle(b).opacity)) : null;
    });
  };
  // How the flight itself reads the rail: aria-checked off the row ancestor.
  const railInkSample = [...document.querySelectorAll('[role="group"][aria-label="Category"] .facet-checkbox-row')]
    .map((r) => ({
      label: (r.textContent || '').trim(),
      ariaChecked: r.getAttribute('aria-checked'),
      closestFound: !!r.querySelector('span span[style]')
        ? true
        : true,
    }));
  const labelClosest = (() => {
    const span = document.querySelector('[role="group"][aria-label="Category"] .facet-checkbox-row span span');
    if (!span) return null;
    const row = span.closest('[role="menuitemcheckbox"]');
    return { found: !!row, ariaChecked: row ? row.getAttribute('aria-checked') : null };
  })();

  const explore = [...document.querySelectorAll('button, a')].find(
    (b) => (b.textContent || '').trim().toUpperCase() === 'EXPLORE'
  );
  if (!explore) return { error: 'no EXPLORE control' };
  const rowsBefore = document.querySelectorAll('[role="group"][aria-label="Category"] .facet-checkbox-row').length;
  const t0 = performance.now();
  const frames = [];
  explore.click();
  for (const at of [0, 80, 160, 240, 340, 520, 760, 980, 1400, 1900]) {
    while (performance.now() - t0 < at) await sleep(8);
    frames.push({
      at,
      t: round(performance.now() - t0),
      boxOpacity: boxOpacity(),
      railRows: document.querySelectorAll('[role="group"][aria-label="Category"] .facet-checkbox-row').length,
      // The flight overlay: fixed, aria-hidden, z-index 190.
      flyingWords: (() => {
        const layers = [...document.querySelectorAll('div[aria-hidden="true"]')].filter(
          (d) => getComputedStyle(d).zIndex === '190' && getComputedStyle(d).position === 'fixed'
        );
        if (!layers.length) return 0;
        return layers[0].querySelectorAll('span').length ? layers[0].children.length : 0;
      })(),
      dialSlots: document.querySelectorAll('[data-dial-slot], [role="listbox"]').length,
      gridTiles: document.querySelectorAll('.grid-tile').length,
    });
  }
  await sleep(400);
  return {
    railInkSample,
    labelClosest,
    rowsBefore,
    frames,
    settled: {
      gridTiles: document.querySelectorAll('.grid-tile').length,
      railRows: document.querySelectorAll('.facet-checkbox-row').length,
      overlays: [...document.querySelectorAll('div[aria-hidden="true"]')].filter(
        (d) => getComputedStyle(d).zIndex === '190'
      ).length,
      bodyText: (document.body.innerText || '').slice(0, 160).replace(/\\s+/g, ' '),
    },
  };
})()`;
out.flight = await evaluate(FLIGHT);
const flightShot = await shot({ x: 0, y: 0, width: 1440, height: 900, scale: 1 }, `/tmp/facet-${TAG}-after-explore.png`);
if (flightShot) out.shots.push(flightShot.file);

/* ── C. phone bar (<=760px): the CATEGORY / LOCATION dropdowns ────────── */
for (const [name, w, h] of [
  ['phone', 390, 844],
  ['compact-max', 760, 900],
]) {
  await setViewport(w, h);
  await send('Page.navigate', { url: `${BASE}/?view=grid` });
  const ready = await evaluate(`(async () => {
    const sleep = (m) => new Promise(r => setTimeout(r, m));
    for (let i = 0; i < 150; i++) {
      if (document.querySelectorAll('.facet-menu-btn').length) break;
      await sleep(200);
    }
    await sleep(2200);
    return document.querySelectorAll('.facet-menu-btn').length;
  })()`);

  const surface = {};
  surface.tabCount = ready;

  for (const facet of ['CATEGORY', 'LOCATION']) {
    const open = await evaluate(`(async () => {
      const sleep = (m) => new Promise(r => setTimeout(r, m));
      const btns = [...document.querySelectorAll('.facet-menu-btn')];
      const openBtn = btns.find((b) => b.getAttribute('aria-expanded') === 'true');
      if (openBtn) { openBtn.click(); await sleep(280); }
      const btn = btns.find((b) => (b.textContent || '').trim().toUpperCase().startsWith('${facet}'));
      if (!btn) return { error: 'no ${facet} tab', tabs: btns.map((b) => (b.textContent||'').trim()) };
      btn.click();
      await sleep(420);
      const read = ${ROW_READER}
      const panel = document.querySelector('[role="menu"]');
      if (!panel) return { error: 'no panel' };
      const pcs = getComputedStyle(panel);
      const pr = panel.getBoundingClientRect();
      const rows = [...panel.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"]')];
      const second = rows[1] ? rows[1].getBoundingClientRect() : null;
      return {
        panel: {
          background: pcs.backgroundColor,
          borderColor: pcs.borderTopColor,
          borderWidth: pcs.borderTopWidth,
          borderRadius: pcs.borderRadius,
          boxShadow: pcs.boxShadow,
          padding: pcs.padding,
          gap: pcs.rowGap,
          box: { w: Math.round(pr.width), h: Math.round(pr.height) },
        },
        rows: rows.map(read),
        clip: { x: Math.max(0, Math.round(pr.left) - 6), y: Math.max(0, Math.round(pr.top) - 6), width: Math.round(pr.width) + 12, height: Math.round(pr.height) + 12, scale: 3 },
        hoverPoint: second ? { x: Math.round(second.left + second.width / 2), y: Math.round(second.top + second.height / 2) } : null,
      };
    })()`);
    surface[facet.toLowerCase()] = open;
    if (open?.clip) {
      const s = await shot(open.clip, `/tmp/facet-${TAG}-${name}-menu-${facet.toLowerCase()}.png`);
      if (s) out.shots.push(s.file);
      if (facet === 'CATEGORY' && name === 'phone') out.phoneMenu.shotB64 = s?.data || null;
      if (facet === 'CATEGORY') {
        // The panel in situ: the docked bar is the phone's whole filter UI, so
        // the crop above can't show whether it still sits right on the screen.
        const full = await shot({ x: 0, y: 0, width: w, height: h, scale: 2 }, `/tmp/facet-${TAG}-${name}-full.png`);
        if (full) out.shots.push(full.file);
      }
    }
    if (open?.hoverPoint) {
      await hover(open.hoverPoint.x, open.hoverPoint.y);
      surface[`${facet.toLowerCase()}Hovered`] = await evaluate(`(() => {
        const read = ${ROW_READER}
        const rows = [...document.querySelectorAll('[role="menu"] [role="menuitemcheckbox"], [role="menu"] [role="menuitem"]')];
        return rows[1] ? read(rows[1]) : null;
      })()`);
      await hover(4, 400);
    }
  }

  /* Checking a row must filter the grid and flip aria-checked. */
  surface.filtering = await evaluate(`(async () => {
    const sleep = (m) => new Promise(r => setTimeout(r, m));
    const read = ${ROW_READER}
    const tiles = () => document.querySelectorAll('.grid-tile').length;
    const btns = [...document.querySelectorAll('.facet-menu-btn')];
    const openBtn = btns.find((b) => b.getAttribute('aria-expanded') === 'true');
    if (openBtn) { openBtn.click(); await sleep(280); }
    const cat = btns.find((b) => (b.textContent || '').trim().toUpperCase().startsWith('CATEGORY'));
    cat.click();
    await sleep(400);
    const panel = document.querySelector('[role="menu"]');
    const rows = [...panel.querySelectorAll('[role="menuitemcheckbox"]')];
    const target = rows.find((r) => r.getAttribute('aria-checked') === 'false');
    if (!target) return { error: 'no unchecked row' };
    const before = { tiles: tiles(), row: read(target), tabActive: getComputedStyle(cat).backgroundColor };
    target.click();
    await sleep(700);
    const checkedRow = read(target);
    const afterCheck = { tiles: tiles(), row: checkedRow, tabActive: getComputedStyle(cat).backgroundColor };
    // The clear-all / "all" row's state while one filter is on.
    const allRow = [...panel.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"]')][0];
    const allWhileFiltered = allRow ? read(allRow) : null;
    target.click();
    await sleep(700);
    const afterUncheck = { tiles: tiles(), row: read(target) };
    const allWhileClear = allRow ? read(allRow) : null;
    // Leave one row checked so the checked-state shot below has a mark in it.
    target.click();
    await sleep(700);
    return { before, afterCheck, afterUncheck, allWhileFiltered, allWhileClear };
  })()`);

  /* The panel with one row checked — the state where the mark itself shows. */
  {
    const checkedShot = await evaluate(`(() => {
      const panel = document.querySelector('[role="menu"]');
      if (!panel) return null;
      const pr = panel.getBoundingClientRect();
      return { x: Math.max(0, Math.round(pr.left) - 6), y: Math.max(0, Math.round(pr.top) - 6), width: Math.round(pr.width) + 12, height: Math.round(pr.height) + 12, scale: 3 };
    })()`);
    if (checkedShot) {
      const s = await shot(checkedShot, `/tmp/facet-${TAG}-${name}-menu-category-checked.png`);
      if (s) out.shots.push(s.file);
      if (name === 'phone') out.phoneMenu.checkedShotB64 = s?.data || null;
    }
  }

  /* Keyboard: focus a value row and toggle it the way Enter/Space would; check
     the clear row can still be reached and reports its own state. */
  surface.keyboard = await evaluate(`(async () => {
    const sleep = (m) => new Promise(r => setTimeout(r, m));
    const panel = document.querySelector('[role="menu"]');
    if (!panel) return { error: 'panel closed' };
    const rows = [...panel.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"]')];
    const focusReach = (el) => { el.focus(); return document.activeElement === el; };
    const value = panel.querySelector('[role="menuitemcheckbox"]');
    const clear = panel.querySelector('[role="menuitem"]:not([role="menuitemcheckbox"])');
    const valueFocused = focusReach(value);
    const cs = getComputedStyle(value);
    const before = value.getAttribute('aria-checked');
    value.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    value.click(); // what Enter/Space do on a native <button>
    await sleep(500);
    const after = value.getAttribute('aria-checked');
    const clearState = clear
      ? {
          label: (clear.textContent || '').trim(),
          role: clear.getAttribute('role'),
          ariaDisabled: clear.getAttribute('aria-disabled'),
          nativeDisabled: clear.disabled === true,
          focusReachable: focusReach(clear),
          color: getComputedStyle(clear).color,
        }
      : null;
    if (before !== after) { value.click(); await sleep(400); }
    return {
      rowsInDom: rows.length,
      focusableRows: rows.filter((r) => !r.disabled).length,
      valueRow: (value.textContent || '').trim(),
      valueFocusReceived: valueFocused,
      outlineStyle: cs.outlineStyle,
      outlineColor: cs.outlineColor,
      ariaCheckedBefore: before,
      ariaCheckedAfter: after,
      clearRow: clearState,
    };
  })()`);

  /* Real key events, so :focus-visible actually engages (a programmatic .focus()
     doesn't set keyboard modality) and Enter goes through the button's own
     activation behaviour rather than a synthetic click. */
  const key = async (type, k, code, vk, text) =>
    send('Input.dispatchKeyEvent', {
      type,
      key: k,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      ...(text ? { text } : null),
    });
  const activeRow = () =>
    evaluate(`(() => {
      const a = document.activeElement;
      if (!a) return null;
      const cs = getComputedStyle(a);
      const box = a.querySelector('.facet-checkbox-box');
      return {
        label: (a.textContent || '').trim().slice(0, 40),
        role: a.getAttribute('role'),
        ariaChecked: a.getAttribute('aria-checked'),
        ariaDisabled: a.getAttribute('aria-disabled'),
        inMenu: !!a.closest('[role="menu"]'),
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        outlineColor: cs.outlineColor,
        markBorder: box ? getComputedStyle(box).borderTopColor : null,
      };
    })()`);

  await evaluate(`(() => {
    const b = [...document.querySelectorAll('.facet-menu-btn')].find((x) => x.getAttribute('aria-expanded') === 'true');
    if (b) b.focus();
    return !!b;
  })()`);
  const tabWalk = [];
  for (let i = 0; i < 3; i++) {
    await key('rawKeyDown', 'Tab', 'Tab', 9);
    await key('keyUp', 'Tab', 'Tab', 9);
    await sleep(140);
    tabWalk.push(await activeRow());
  }
  surface.tabWalk = tabWalk;

  // Enter on whatever the walk landed on, then Enter again to put it back.
  const enter = async () => {
    await key('keyDown', 'Enter', 'Enter', 13, '\r');
    await key('keyUp', 'Enter', 'Enter', 13);
    await sleep(600);
    return activeRow();
  };
  surface.enterToggle = { after: await enter() };
  if (surface.enterToggle.after?.role === 'menuitemcheckbox') {
    const focusShot = await evaluate(`(() => {
      const p = document.querySelector('[role="menu"]');
      if (!p) return null;
      const r = p.getBoundingClientRect();
      return { x: Math.max(0, Math.round(r.left) - 8), y: Math.max(0, Math.round(r.top) - 8), width: Math.round(r.width) + 16, height: Math.round(r.height) + 16, scale: 3 };
    })()`);
    if (focusShot) {
      const s = await shot(focusShot, `/tmp/facet-${TAG}-${name}-menu-keyboard-focus.png`);
      if (s) out.shots.push(s.file);
    }
    surface.enterToggle.back = await enter();
  }

  out.phoneMenu[name] = surface;
}

/* ── D. side-by-side composite (dropdown at phone width | sidebar at 1440) */
if (out.phoneMenu.shotB64 && out.desktopSidebar.shotB64) {
  const composite = `/tmp/facet-${TAG}-sidebyside.png`;
  await setViewport(1600, 1000);
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(150);
  await evaluate(`(() => {
    document.documentElement.style.background = '#0a0a0a';
    document.body.style.cssText = 'margin:0;background:#0a0a0a;display:grid;grid-template-columns:repeat(2, 420px);gap:28px 32px;align-items:start;padding:24px;font:12px ui-monospace,monospace;color:#CFCAB7';
    const cell = (title, b64) => {
      const w = document.createElement('div');
      w.style.cssText = 'display:flex;flex-direction:column;gap:8px';
      const h = document.createElement('div');
      h.textContent = title;
      const i = document.createElement('img');
      i.src = 'data:image/png;base64,' + b64;
      i.style.cssText = 'display:block;height:auto;image-rendering:pixelated;width:420px';
      w.append(h, i);
      return w;
    };
    const shots = ${JSON.stringify({
      a: out.phoneMenu.shotB64,
      b: out.desktopSidebar.shotB64,
      c: out.phoneMenu.checkedShotB64 || null,
      d: out.desktopSidebar.checkedShotB64 || null,
    })};
    document.body.append(
      cell('DROPDOWN 390px — nothing checked', shots.a),
      cell('SIDEBAR 1440px — nothing checked', shots.b)
    );
    if (shots.c) document.body.append(cell('DROPDOWN 390px — one checked', shots.c));
    if (shots.d) document.body.append(cell('SIDEBAR 1440px — one checked', shots.d));
    return true;
  })()`);
  await sleep(400);
  const m = await evaluate(`(() => { const r = document.body.getBoundingClientRect(); return { w: Math.ceil(r.width), h: Math.ceil(document.body.scrollHeight) }; })()`);
  const s = await shot({ x: 0, y: 0, width: Math.min(1600, m.w + 24), height: Math.min(2400, m.h + 24), scale: 1 }, composite);
  if (s) out.shots.push(s.file);
}
delete out.phoneMenu.shotB64;
delete out.phoneMenu.checkedShotB64;
delete out.desktopSidebar.shotB64;
delete out.desktopSidebar.checkedShotB64;

/* ── summary ──────────────────────────────────────────────────────────── */
const pick = (r) => (r ? `${r.label} · role=${r.role} · aria-checked=${r.ariaChecked} · text ${r.rowColor} · bg ${r.rowBackground} · mark ${r.mark ? `${r.mark.cls || r.mark.tag} ${r.mark.size} r=${r.mark.borderRadius} border ${r.mark.borderColor} ink ${r.mark.color} tick=${r.mark.hasSvgTick}` : 'none'}${r.tick ? ` · stroke ${r.tick.stroke} drawn ${r.tick.pathDrawn} op ${r.tick.opacity}` : ''}` : 'n/a');

out.summary = {
  sidebarRest: (out.desktopSidebar.rest || []).slice(0, 3).map(pick),
  sidebarHovered: pick(out.desktopSidebar.hovered),
  sidebarChecked: pick(out.desktopSidebar.checked),
  menuRest: (out.phoneMenu.phone?.category?.rows || []).slice(0, 3).map(pick),
  menuHovered: pick(out.phoneMenu.phone?.categoryHovered),
  menuChecked: pick(out.phoneMenu.phone?.filtering?.afterCheck?.row),
  menuPanel: out.phoneMenu.phone?.category?.panel,
  sidebarBackdrop: out.desktopSidebar.backdrop,
  locationMenuRest: (out.phoneMenu.phone?.location?.rows || []).slice(0, 3).map(pick),
  allRow: {
    whileClear: pick(out.phoneMenu.phone?.filtering?.allWhileClear),
    whileFiltered: pick(out.phoneMenu.phone?.filtering?.allWhileFiltered),
  },
  filtering: out.phoneMenu.phone?.filtering
    ? `tiles ${out.phoneMenu.phone.filtering.before?.tiles} → checked ${out.phoneMenu.phone.filtering.afterCheck?.tiles} → unchecked ${out.phoneMenu.phone.filtering.afterUncheck?.tiles} · aria ${out.phoneMenu.phone.filtering.before?.row?.ariaChecked} → ${out.phoneMenu.phone.filtering.afterCheck?.row?.ariaChecked} → ${out.phoneMenu.phone.filtering.afterUncheck?.row?.ariaChecked}`
    : 'n/a',
  keyboard: out.phoneMenu.phone?.keyboard,
  tabWalk: out.phoneMenu.phone?.tabWalk,
  enterToggle: out.phoneMenu.phone?.enterToggle,
  flight: out.flight?.frames
    ? out.flight.frames.map((f) => `${f.at}ms boxOp=[${f.boxOpacity.join(',')}] railRows=${f.railRows} flying=${f.flyingWords} tiles=${f.gridTiles}`)
    : out.flight,
  flightLabelClosest: out.flight?.labelClosest,
  flightSettled: out.flight?.settled,
};

console.log(JSON.stringify(out, null, 1));

ws.close();
chrome.kill();
