/**
 * The reset row ("ALL CATEGORIES" / "ALL LOCATIONS") at the top of the phone
 * bar's facet dropdowns, and what the menus look like without it.
 *
 * Reads, for both dropdowns at phone width: every child of the role="menu" and
 * its role, where the first checkbox row sits relative to the panel's content
 * box, the gaps between rows, and any hairline left inside the panel — so
 * "nothing stray behind it" is a number. Then walks Tab from the facet tab into
 * the list, and drives a filter-and-clear round trip (including with a search
 * query on top) to prove a phone user can always get back to the full grid.
 *
 * Also checks the claim that the reset row is "desktop's": whether the docked
 * bar exists at all above the 760px compact breakpoint.
 *
 * TAG=with|without names the shots. Throwaway diagnostic; safe to delete.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5191';
const TAG = process.env.TAG || 'with';
const PORT = Number(process.env.PORT || 9401);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  `--user-data-dir=/tmp/facet-mobile-clear-profile-${PORT}`,
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
  if (r?.exceptionDetails)
    return { error: r.exceptionDetails.text, detail: r.exceptionDetails.exception?.description };
  return r?.result?.value;
};
await send('Page.enable');
await send('Runtime.enable');

const setViewport = (width, height) =>
  send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
const shoot = async (clip, file) => {
  const s = await send('Page.captureScreenshot', { format: 'png', clip });
  if (!s?.data) return null;
  fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
  return file;
};
const key = (type, k, code, vk, text) =>
  send('Input.dispatchKeyEvent', {
    type,
    key: k,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
    ...(text ? { text } : null),
  });
const tab = async () => {
  await key('rawKeyDown', 'Tab', 'Tab', 9);
  await key('keyUp', 'Tab', 'Tab', 9);
  await sleep(140);
};

const out = { tag: TAG, shots: [] };

/* ── Is there a dropdown above the compact breakpoint at all? ──────────── */
await setViewport(1440, 900);
await send('Page.navigate', { url: `${BASE}/?view=grid` });
await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 150; i++) {
    if (document.querySelectorAll('.facet-checkbox-row, .facet-menu-btn').length) break;
    await sleep(200);
  }
  await sleep(2000);
  return true;
})()`);
out.desktop = await evaluate(`(() => {
  const rail = [...document.querySelectorAll('[role="group"][aria-label="Category"] .facet-checkbox-row')];
  return {
    matchesCompactQuery: window.matchMedia('(max-width: 760px)').matches,
    dockedBarTabs: document.querySelectorAll('.facet-menu-btn').length,
    dropdowns: document.querySelectorAll('[role="menu"]').length,
    railClearRows: document.querySelectorAll('.facet-menu-clear').length,
    railRows: rail.length,
    railFirstRow: rail[0] ? (rail[0].textContent || '').trim() : null,
    railRoles: rail.map((r) => r.getAttribute('role')),
  };
})()`);

/* ── Phone: both dropdowns, geometry + roles ──────────────────────────── */
await setViewport(390, 844);
await send('Page.navigate', { url: `${BASE}/?view=grid` });
await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 150; i++) {
    if (document.querySelectorAll('.facet-menu-btn').length) break;
    await sleep(200);
  }
  await sleep(2200);
  return true;
})()`);

const MENU_GEOM = `(() => {
  const round = (n) => Math.round(n * 100) / 100;
  const panel = document.querySelector('[role="menu"]');
  if (!panel) return { error: 'no panel' };
  const pcs = getComputedStyle(panel);
  const pr = panel.getBoundingClientRect();
  // The panel's content box: where a first child is allowed to start.
  const contentTop = pr.top + parseFloat(pcs.borderTopWidth) + parseFloat(pcs.paddingTop);
  const kids = [...panel.children];
  const firstCheckbox = panel.querySelector('[role="menuitemcheckbox"]');
  const fr = firstCheckbox ? firstCheckbox.getBoundingClientRect() : null;
  return {
    panel: {
      top: round(pr.top),
      height: round(pr.height),
      borderTopWidth: pcs.borderTopWidth,
      paddingTop: pcs.paddingTop,
      rowGap: pcs.rowGap,
      contentTop: round(contentTop),
    },
    childCount: kids.length,
    children: kids.map((el, i) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const label = (el.textContent || '').trim();
      const prev = i ? kids[i - 1].getBoundingClientRect() : null;
      return {
        i,
        label,
        role: el.getAttribute('role'),
        ariaChecked: el.getAttribute('aria-checked'),
        ariaDisabled: el.getAttribute('aria-disabled'),
        top: round(r.top),
        height: round(r.height),
        // Anything drawing a rule inside the panel.
        borderBottom: cs.borderBottomStyle === 'none' ? null : cs.borderBottomWidth + ' ' + cs.borderBottomColor,
        marginBottom: cs.marginBottom,
        paddingTop: cs.paddingTop,
        paddingBottom: cs.paddingBottom,
        paddingLeft: cs.paddingLeft,
        // Where the label's own text box starts, so the left column can be
        // compared row to row.
        labelLeft: (() => {
          const span = el.querySelector('span:not(.facet-checkbox-box)');
          return span ? round(span.getBoundingClientRect().left) : null;
        })(),
        gapFromPrev: prev ? round(r.top - prev.bottom) : round(r.top - contentTop),
      };
    }),
    firstCheckbox: fr
      ? {
          label: (firstCheckbox.textContent || '').trim(),
          top: round(fr.top),
          // The headline number: how far the first checkbox row sits below the
          // panel's content box.
          offsetFromContentTop: round(fr.top - contentTop),
          offsetFromPanelTop: round(fr.top - pr.top),
        }
      : null,
    rulesInsidePanel: [...panel.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el);
      return cs.borderBottomStyle !== 'none' && parseFloat(cs.borderBottomWidth) > 0;
    }).length,
    roles: kids.map((el) => el.getAttribute('role')),
    invalidMenuChildren: kids
      .map((el) => el.getAttribute('role'))
      .filter((r) => !['menuitem', 'menuitemcheckbox', 'menuitemradio', 'separator', 'group', 'none', 'presentation'].includes(r)),
  };
})()`;

const openFacet = (facet) =>
  evaluate(`(async () => {
    const sleep = (m) => new Promise(r => setTimeout(r, m));
    const btns = [...document.querySelectorAll('.facet-menu-btn')];
    const open = btns.find((b) => b.getAttribute('aria-expanded') === 'true');
    if (open) { open.click(); await sleep(300); }
    const btn = btns.find((b) => (b.textContent || '').trim().toUpperCase().startsWith('${facet}'));
    if (!btn) return false;
    btn.click();
    await sleep(450);
    return true;
  })()`);

out.phone = {};
for (const facet of ['CATEGORY', 'LOCATION']) {
  await openFacet(facet);
  const geom = await evaluate(MENU_GEOM);
  out.phone[facet.toLowerCase()] = geom;
  const clip = await evaluate(`(() => {
    const p = document.querySelector('[role="menu"]');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: Math.max(0, Math.round(r.left) - 10), y: Math.max(0, Math.round(r.top) - 46), width: Math.round(r.width) + 20, height: Math.round(r.height) + 56, scale: 3 };
  })()`);
  if (clip) out.shots.push(await shoot(clip, `/tmp/facet-clear-${TAG}-phone-${facet.toLowerCase()}.png`));
  const full = await shoot({ x: 0, y: 0, width: 390, height: 844, scale: 2 }, `/tmp/facet-clear-${TAG}-phone-${facet.toLowerCase()}-full.png`);
  if (full) out.shots.push(full);
}

/* ── Keyboard: from the facet tab straight into the list ───────────────── */
await openFacet('CATEGORY');
await evaluate(`(() => {
  const b = [...document.querySelectorAll('.facet-menu-btn')].find((x) => x.getAttribute('aria-expanded') === 'true');
  if (b) b.focus();
  return !!b;
})()`);
const activeRow = () =>
  evaluate(`(() => {
    const a = document.activeElement;
    if (!a) return null;
    const cs = getComputedStyle(a);
    return {
      label: (a.textContent || '').trim().slice(0, 40),
      role: a.getAttribute('role'),
      ariaChecked: a.getAttribute('aria-checked'),
      ariaDisabled: a.getAttribute('aria-disabled'),
      inMenu: !!a.closest('[role="menu"]'),
      isFacetTab: a.classList.contains('facet-menu-btn'),
      outline: cs.outlineStyle + ' ' + cs.outlineWidth,
    };
  })()`);
out.keyboard = { start: await activeRow(), walk: [] };
for (let i = 0; i < 3; i++) {
  await tab();
  out.keyboard.walk.push(await activeRow());
}
// Enter on whatever the walk reached, then again to undo.
const enter = async () => {
  await key('keyDown', 'Enter', 'Enter', 13, '\r');
  await key('keyUp', 'Enter', 'Enter', 13);
  await sleep(650);
  return activeRow();
};
out.keyboard.enter = await enter();
out.keyboard.enterAgain = await enter();

/* ── Can a phone user always get back to the whole grid? ──────────────── */
out.clearability = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  const tiles = () => document.querySelectorAll('.grid-tile').length;
  const pill = () => {
    const b = [...document.querySelectorAll('.facet-menu-btn')].find((x) => (x.textContent || '').trim().toUpperCase().startsWith('CATEGORY'));
    return b ? getComputedStyle(b).backgroundColor : null;
  };
  const rows = () => [...document.querySelectorAll('[role="menu"] [role="menuitemcheckbox"]')];
  const openCat = async () => {
    const btns = [...document.querySelectorAll('.facet-menu-btn')];
    const open = btns.find((b) => b.getAttribute('aria-expanded') === 'true');
    if (open) { open.click(); await sleep(300); }
    btns.find((b) => (b.textContent || '').trim().toUpperCase().startsWith('CATEGORY')).click();
    await sleep(420);
  };
  await openCat();
  const start = { tiles: tiles(), pill: pill(), rows: rows().length };

  // Two categories on, then both off again — the only reset a phone has now.
  const a = rows()[0], b = rows()[1];
  a.click(); await sleep(500);
  b.click(); await sleep(600);
  const twoOn = { tiles: tiles(), pill: pill(), checked: rows().filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => (r.textContent || '').trim()) };
  rows()[0].click(); await sleep(500);
  rows()[1].click(); await sleep(600);
  const cleared = { tiles: tiles(), pill: pill(), checked: rows().filter((r) => r.getAttribute('aria-checked') === 'true').length };

  // A search query on top of a checked category: the rows are derived from the
  // whole set, so the checked one must still be listed (and untickable) even
  // when the query alone would empty the grid.
  rows()[0].click(); await sleep(500);
  const checkedLabel = (rows()[0].textContent || '').trim();
  const input = document.querySelector('.grid-search-input');
  const setValue = (el, v) => {
    const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
    d.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setValue(input, 'zzzqqq-no-such-transcript');
  await sleep(700);
  await openCat();
  const withDeadQuery = {
    tiles: tiles(),
    rowsListed: rows().length,
    checkedStillListed: rows().some((r) => (r.textContent || '').trim() === checkedLabel && r.getAttribute('aria-checked') === 'true'),
    emptyStateClearButton: [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim().toLowerCase() === 'clear all filters'),
  };
  // Unticking from that state must still work.
  const back = rows().find((r) => (r.textContent || '').trim() === checkedLabel);
  back.click(); await sleep(600);
  const afterUntick = { tiles: tiles(), ariaChecked: back.getAttribute('aria-checked') };
  setValue(input, '');
  await sleep(700);
  return { start, twoOn, cleared, withDeadQuery, afterUntick, restored: tiles() };
})()`);

/* ── Desktop rail unchanged: reset row present, disabled, and clearing ─── */
await setViewport(1440, 900);
await send('Page.navigate', { url: `${BASE}/?view=grid` });
await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  for (let i = 0; i < 150; i++) {
    if (document.querySelectorAll('.facet-checkbox-row').length) break;
    await sleep(200);
  }
  await sleep(2000);
  return true;
})()`);
out.desktopAfter = await evaluate(`(async () => {
  const sleep = (m) => new Promise(r => setTimeout(r, m));
  const rows = () => [...document.querySelectorAll('[role="group"][aria-label="Category"] .facet-checkbox-row')];
  const tiles = () => document.querySelectorAll('.grid-tile').length;
  const before = { rows: rows().length, tiles: tiles(), clearRows: document.querySelectorAll('.facet-menu-clear').length };
  rows()[1].click();
  await sleep(700);
  const checked = { tiles: tiles(), ariaChecked: rows()[1].getAttribute('aria-checked') };
  rows()[1].click();
  await sleep(700);
  return { before, checked, after: { tiles: tiles(), ariaChecked: rows()[1].getAttribute('aria-checked') } };
})()`);
out.shots.push(await shoot({ x: 0, y: 0, width: 1440, height: 900, scale: 1 }, `/tmp/facet-clear-${TAG}-desktop.png`));

out.summary = {
  desktopHasDropdown: `matchesCompactQuery=${out.desktop?.matchesCompactQuery} · dockedBarTabs=${out.desktop?.dockedBarTabs} · dropdowns=${out.desktop?.dropdowns} · railRows=${out.desktop?.railRows} first="${out.desktop?.railFirstRow}" · clearRowsAnywhere=${out.desktop?.railClearRows}`,
  category: {
    childCount: out.phone?.category?.childCount,
    roles: out.phone?.category?.roles,
    invalid: out.phone?.category?.invalidMenuChildren,
    firstCheckbox: out.phone?.category?.firstCheckbox,
    rulesInsidePanel: out.phone?.category?.rulesInsidePanel,
    gaps: (out.phone?.category?.children || []).map((c) => `${c.label}: gapFromPrev=${c.gapFromPrev} padT=${c.paddingTop} padB=${c.paddingBottom} padL=${c.paddingLeft} border=${c.borderBottom || 'none'} mb=${c.marginBottom} labelLeft=${c.labelLeft}`),
  },
  location: {
    childCount: out.phone?.location?.childCount,
    roles: out.phone?.location?.roles,
    invalid: out.phone?.location?.invalidMenuChildren,
    firstCheckbox: out.phone?.location?.firstCheckbox,
    rulesInsidePanel: out.phone?.location?.rulesInsidePanel,
  },
  keyboard: out.keyboard,
  clearability: out.clearability,
  desktopAfter: out.desktopAfter,
};

console.log(JSON.stringify(out, null, 1));
ws.close();
chrome.kill();
