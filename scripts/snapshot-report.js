/* Paste into DevTools console ON the run report page.
   Exports a self-contained .html: report only (no app shell), all 52 criteria,
   with the fold + ledger interactions intact. */
(async () => {
  const RUN_ID = location.pathname.match(/runs\/([^/]+)/)?.[1] ?? 'report';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const idOf = btn => btn.querySelectorAll('span')[1]?.textContent.trim() ?? '';

  // 1. Walk every criterion, cloning its rendered detail pane.
  //    <details> state is irrelevant here: Fold always renders its children,
  //    so we leave the folds exactly as the user left them.
  const grid = document.querySelector('#rubrics .grid');
  if (!grid) throw new Error('rubrics grid not found - are you on the report page?');
  const items = [...document.querySelectorAll('[data-testid="run-report-ledger-item"]')];
  const captured = [];
  for (const btn of items) {
    btn.click();
    await sleep(120);
    const pane = grid.children[1];
    if (pane) captured.push({ id: idOf(btn), node: pane.cloneNode(true) });
  }
  console.log(`captured ${captured.length} / ${items.length} criteria`);

  // 2. Rebuild the ledger: real rail clone + every pane, toggled by a tiny shim.
  const rail = grid.children[0].cloneNode(true);
  rail.querySelectorAll('[data-testid="run-report-ledger-item"]').forEach(b => {
    b.setAttribute('data-crit', idOf(b));
    b.classList.remove('bg-muted/60');
  });
  rail.querySelector('[data-crit]')?.classList.add('bg-muted/60');

  const panes = document.createElement('div');
  captured.forEach(({ id, node }, i) => {
    const box = document.createElement('div');
    box.setAttribute('data-pane', id);
    if (i > 0) box.hidden = true;
    box.appendChild(node);
    panes.appendChild(box);
  });

  const newGrid = grid.cloneNode(false);          // keeps the two-column classes
  newGrid.append(rail, panes);
  grid.replaceWith(newGrid);

  // 3. Inline stylesheets; embed fonts as data URIs so it renders offline.
  const cache = new Map();
  const inlineUrls = async (cssText, base) => {
    const urls = [...new Set([...cssText.matchAll(/url\((['"]?)([^'")]+)\1\)/g)].map(m => m[2]))]
      .filter(u => !u.startsWith('data:'));
    for (const u of urls) {
      const abs = new URL(u, base).href;
      if (!cache.has(abs)) {
        try {
          const blob = await fetch(abs).then(r => r.blob());
          cache.set(abs, await new Promise(res => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.readAsDataURL(blob);
          }));
        } catch { cache.set(abs, abs); }
      }
      cssText = cssText.split(u).join(cache.get(abs));
    }
    return cssText;
  };
  let css = '';
  for (const link of [...document.querySelectorAll('link[rel="stylesheet"]')]) {
    try {
      css += await inlineUrls(await fetch(link.href).then(r => r.text()), link.href) + '\n';
    } catch (e) { console.warn('skipped stylesheet', link.href, e); }
  }
  for (const s of [...document.querySelectorAll('style')]) css += s.textContent + '\n';

  // 4. Keep only <main> - the sidebar, global search and banners are its siblings.
  const main = document.querySelector('main');
  if (!main) throw new Error('<main> not found');

  const doc = document.documentElement.cloneNode(false);   // <html>, keeps theme classes
  const head = document.createElement('head');
  head.innerHTML = '<meta charset="utf-8"><title>' + document.title + '</title>';
  const style = document.createElement('style');
  style.textContent = css + `
    html,body{height:auto!important;overflow:visible!important;margin:0}
    body{background:var(--background);color:var(--foreground)}
  `;
  head.appendChild(style);

  const body = document.createElement('body');
  body.className = document.body.className;
  const wrap = document.createElement('div');
  wrap.style.cssText = 'max-width:1200px;margin:0 auto;padding:32px 24px';
  [...main.children].forEach(c => wrap.appendChild(c.cloneNode(true)));
  body.appendChild(wrap);

  doc.append(head, body);
  doc.querySelectorAll('script, next-route-announcer, template').forEach(n => n.remove());
  doc.querySelectorAll('a[href^="/"]').forEach(a => a.setAttribute('href', location.origin + a.getAttribute('href')));

  // 5. The ledger shim - the only JS the exported file needs.
  const shim = document.createElement('script');
  shim.textContent = `document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-crit]');
  if (!b) return;
  var id = b.getAttribute('data-crit');
  document.querySelectorAll('[data-pane]').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== id; });
  document.querySelectorAll('[data-crit]').forEach(function (x) { x.classList.toggle('bg-muted/60', x === b); });
});`;
  doc.querySelector('body').appendChild(shim);

  const html = '<!doctype html>\n' + doc.outerHTML;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = `run-report-${RUN_ID}.html`;
  a.click();
  console.log(`saved run-report-${RUN_ID}.html - ${(html.length / 1048576).toFixed(2)} MB, ${captured.length} criteria`);
})();
