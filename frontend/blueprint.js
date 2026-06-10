'use strict';

// ── Blueprint visual editor ───────────────────────────────────────────────────
//
// Pyramid layout: each depth level occupies one horizontal row.
// Root is at the top, children spread out below it.
// Connector lines drawn on a canvas layer behind the nodes.
// Clicking a node opens a floating popover for editing.
// The + button below each node lets you add a child folder or file.

const LANGS   = ['', 'rs', 'py', 'c', 'cpp', 'go'];
const RANKS   = ['skirmish','tactic','strategy','battle','theater','war'];

// ── State ─────────────────────────────────────────────────────────────────────

let tree      = null;   // root node or null
let nextId    = 1;
let popover   = null;   // currently open popover DOM element
let activeId  = null;   // node id whose popover is open

function newFolder(name = 'folder', lang = '', owner = '') {
  return { id: nextId++, kind: 'folder', name, lang, owner, children: [] };
}

function newFile(name = 'file', fns = [], owner = '') {
  return { id: nextId++, kind: 'file', name, fns, owner };
}

function findNode(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  if (node.kind === 'folder') {
    for (const c of node.children) {
      const r = findNode(c, id);
      if (r) return r;
    }
  }
  return null;
}

function removeNode(parent, id) {
  if (parent.kind !== 'folder') return false;
  const idx = parent.children.findIndex(c => c.id === id);
  if (idx !== -1) { parent.children.splice(idx, 1); return true; }
  for (const c of parent.children) {
    if (removeNode(c, id)) return true;
  }
  return false;
}

function depthOf(node, target, d = 0) {
  if (node.id === target) return d;
  if (node.kind === 'folder') {
    for (const c of node.children) {
      const r = depthOf(c, target, d + 1);
      if (r !== -1) return r;
    }
  }
  return -1;
}

function maxDepth(node, d = 0) {
  if (node.kind === 'file' || !node.children.length) return d;
  return Math.max(...node.children.map(c => maxDepth(c, d + 1)));
}

// ── Blueprint .bu serializer ──────────────────────────────────────────────────

function serialize(node, indent = 0) {
  const pad  = '    '.repeat(indent);
  const pad1 = '    '.repeat(indent + 1);

  if (node.kind === 'file') {
    const fns  = node.fns.length ? node.fns.join(', ') : '';
    const stub = fns ? `: ${fns}` : ': _';
    if (node.owner) {
      return `${pad}${node.name}.bu ${stub} {\n${pad1}owner : "${node.owner}"\n${pad}}\n`;
    }
    return `${pad}${node.name}.bu ${stub};\n`;
  }

  // folder
  const langPrefix = node.lang ? `${node.lang}: ` : '';
  const depth      = tree ? depthOf(tree, node.id) : 0;
  const rank       = RANKS[Math.min(depth, RANKS.length - 1)];
  const header     = `${pad}${langPrefix}${rank} ${node.name}`;

  if (!node.children.length) {
    return `${header} {}\n`;
  }

  const inner = node.children.map(c => serialize(c, indent + 1)).join('');
  const ownerLine = node.owner ? `${pad1}// owner: ${node.owner}\n` : '';
  return `${header} {\n${ownerLine}${inner}${pad}}\n`;
}

function generateBu() {
  if (!tree) return '';
  return serialize(tree, 0);
}

// ── Render ────────────────────────────────────────────────────────────────────

let renderRoot = null;
let canvasEl   = null;

export function mountBlueprint(container) {
  container.innerHTML = '';

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'bp-toolbar';

  const savePathIn = document.createElement('input');
  savePathIn.className = 'bp-save-path';
  savePathIn.type = 'text';
  savePathIn.placeholder = '/home/user/project/blueprint.bu';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-save-bp';
  saveBtn.textContent = 'Save blueprint';

  const statusEl = document.createElement('span');
  statusEl.className = 'bp-status';

  toolbar.appendChild(savePathIn);
  toolbar.appendChild(saveBtn);
  toolbar.appendChild(statusEl);
  container.appendChild(toolbar);

  // Canvas + pyramid wrap
  const stage = document.createElement('div');
  stage.className = 'bp-stage';

  canvasEl = document.createElement('canvas');
  canvasEl.className = 'bp-canvas';
  stage.appendChild(canvasEl);

  renderRoot = document.createElement('div');
  renderRoot.className = 'bp-pyramid';
  stage.appendChild(renderRoot);

  container.appendChild(stage);

  // Empty state — just a root "+" button
  if (!tree) {
    renderEmpty(renderRoot);
  } else {
    renderTree();
  }

  // Close popover on outside click
  document.addEventListener('pointerdown', onOutsideClick, { capture: true });

  // Save
  saveBtn.addEventListener('click', async () => {
    const path = savePathIn.value.trim();
    if (!path) { setStatus(statusEl, 'Enter a save path first.', false); return; }
    const content = generateBu();
    if (!content) { setStatus(statusEl, 'Nothing to save.', false); return; }

    saveBtn.disabled = true;
    try {
      const res  = await fetch('/api/blueprint/save', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ path, content }),
      });
      const data = await res.json();
      setStatus(statusEl, data.ok ? `Saved to ${path}` : (data.error || 'Save failed.'), data.ok);
    } catch (e) {
      setStatus(statusEl, `Network error: ${e.message}`, false);
    } finally {
      saveBtn.disabled = false;
    }
  });
}

export function unmountBlueprint() {
  document.removeEventListener('pointerdown', onOutsideClick, { capture: true });
  closePopover();
  tree    = null;
  nextId  = 1;
}

function setStatus(el, msg, ok) {
  el.textContent = msg;
  el.className   = `bp-status ${ok ? 'ok' : 'err'}`;
}

// ── Empty state ───────────────────────────────────────────────────────────────

function renderEmpty(root) {
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'bp-empty';
  wrap.innerHTML = `<div class="bp-empty-text">Start your blueprint by creating the root folder.</div>`;

  const addBtn = document.createElement('button');
  addBtn.className = 'bp-add-root';
  addBtn.textContent = '+ Create root folder';
  addBtn.addEventListener('click', () => {
    tree = newFolder('root');
    renderTree();
  });

  wrap.appendChild(addBtn);
  root.appendChild(wrap);
}

// ── Full tree render ──────────────────────────────────────────────────────────

function renderTree() {
  if (!renderRoot) return;
  closePopover();
  renderRoot.innerHTML = '';

  // Collect levels via BFS
  const levels = [];
  let current  = [{ node: tree, parentId: null }];
  while (current.length) {
    levels.push(current);
    const next = [];
    for (const { node } of current) {
      if (node.kind === 'folder') {
        for (const c of node.children) {
          next.push({ node: c, parentId: node.id });
        }
      }
    }
    current = next;
  }

  // Render rows
  const nodeEls = {};  // id → DOM element

  for (const level of levels) {
    const row = document.createElement('div');
    row.className = 'bp-row';

    for (const { node } of level) {
      const el = renderNode(node);
      nodeEls[node.id] = el;
      row.appendChild(el);
    }

    renderRoot.appendChild(row);
  }

  // Draw connectors after layout is painted
  requestAnimationFrame(() => drawConnectors(levels, nodeEls));
}

// ── Node element ──────────────────────────────────────────────────────────────

function renderNode(node) {
  const wrap = document.createElement('div');
  wrap.className = `bp-node bp-node-${node.kind}`;
  wrap.dataset.id = node.id;

  // Card body
  const card = document.createElement('div');
  card.className = 'bp-card';
  card.addEventListener('click', (e) => { e.stopPropagation(); openPopover(node, card); });

  const icon = document.createElement('span');
  icon.className = 'bp-node-icon';
  icon.textContent = node.kind === 'folder' ? '📁' : '📄';

  const nameEl = document.createElement('span');
  nameEl.className = 'bp-node-name';
  nameEl.textContent = node.kind === 'folder'
    ? node.name + (node.lang ? `  [${node.lang}]` : '')
    : node.name + '.bu';

  card.appendChild(icon);
  card.appendChild(nameEl);

  if (node.kind === 'file' && node.fns.length) {
    const fnsEl = document.createElement('div');
    fnsEl.className = 'bp-node-fns';
    fnsEl.textContent = node.fns.join(', ');
    card.appendChild(fnsEl);
  }

  if (node.owner) {
    const ownerEl = document.createElement('div');
    ownerEl.className = 'bp-node-owner';
    ownerEl.textContent = `@${node.owner}`;
    card.appendChild(ownerEl);
  }

  wrap.appendChild(card);

  // + button (only folders get children)
  if (node.kind === 'folder') {
    const addBtn = document.createElement('button');
    addBtn.className = 'bp-add-child';
    addBtn.textContent = '+';
    addBtn.title = 'Add child';
    addBtn.addEventListener('click', (e) => { e.stopPropagation(); openAddChild(node, addBtn); });
    wrap.appendChild(addBtn);
  }

  return wrap;
}

// ── Popover: edit node ────────────────────────────────────────────────────────

function openPopover(node, anchor) {
  if (activeId === node.id) { closePopover(); return; }
  closePopover();
  activeId = node.id;
  anchor.closest('.bp-card').classList.add('bp-card-active');

  const pop = document.createElement('div');
  pop.className = 'bp-popover';
  pop.dataset.popover = 'edit';

  const title = document.createElement('div');
  title.className = 'bp-pop-title';
  title.textContent = node.kind === 'folder' ? 'Edit folder' : 'Edit file';
  pop.appendChild(title);

  // Name
  pop.appendChild(popField('Name', node.name, (v) => { node.name = v; refreshNode(node); }));

  if (node.kind === 'folder') {
    // Lang
    const langSel = document.createElement('select');
    langSel.className = 'bp-pop-select';
    LANGS.forEach(l => {
      const o = document.createElement('option');
      o.value = l; o.textContent = l || 'auto';
      if (l === node.lang) o.selected = true;
      langSel.appendChild(o);
    });
    langSel.addEventListener('change', () => { node.lang = langSel.value; refreshNode(node); });
    const lg = document.createElement('div');
    lg.className = 'bp-pop-field';
    const ll = document.createElement('label');
    ll.textContent = 'Language';
    lg.appendChild(ll);
    lg.appendChild(langSel);
    pop.appendChild(lg);
  }

  if (node.kind === 'file') {
    // Functions
    const fnsWrap = document.createElement('div');
    fnsWrap.className = 'bp-pop-field';
    const fnsLbl = document.createElement('label');
    fnsLbl.textContent = 'Functions';
    const fnsIn = document.createElement('input');
    fnsIn.className = 'bp-pop-input';
    fnsIn.type = 'text';
    fnsIn.placeholder = 'fn1, fn2, fn3';
    fnsIn.value = node.fns.join(', ');
    fnsIn.addEventListener('input', () => {
      node.fns = fnsIn.value.split(',').map(s => s.trim()).filter(Boolean);
      refreshNode(node);
    });
    fnsWrap.appendChild(fnsLbl);
    fnsWrap.appendChild(fnsIn);
    pop.appendChild(fnsWrap);
  }

  // Owner
  pop.appendChild(popField('Owner (optional)', node.owner || '', (v) => { node.owner = v; refreshNode(node); }));

  // Delete
  if (node !== tree) {
    const delBtn = document.createElement('button');
    delBtn.className = 'bp-pop-delete';
    delBtn.textContent = 'Delete node';
    delBtn.addEventListener('click', () => {
      removeNode(tree, node.id);
      closePopover();
      renderTree();
    });
    pop.appendChild(delBtn);
  }

  positionPopover(pop, anchor);
  document.body.appendChild(pop);
  popover = pop;
}

function popField(label, value, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'bp-pop-field';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  const inp = document.createElement('input');
  inp.className = 'bp-pop-input';
  inp.type = 'text';
  inp.value = value;
  inp.addEventListener('input', () => onChange(inp.value.trim()));
  wrap.appendChild(lbl);
  wrap.appendChild(inp);
  return wrap;
}

function positionPopover(pop, anchor) {
  // Temporarily append off-screen to measure
  pop.style.visibility = 'hidden';
  pop.style.position = 'fixed';
  document.body.appendChild(pop);

  const rect  = anchor.getBoundingClientRect();
  const pw    = pop.offsetWidth  || 220;
  const ph    = pop.offsetHeight || 200;
  const vw    = window.innerWidth;
  const vh    = window.innerHeight;
  const gap   = 10;

  let left = rect.right + gap;
  let top  = rect.top;

  if (left + pw > vw - gap) left = rect.left - pw - gap;
  if (top  + ph > vh - gap) top  = vh - ph - gap;
  if (top  < gap)           top  = gap;

  pop.style.left       = `${left}px`;
  pop.style.top        = `${top}px`;
  pop.style.visibility = 'visible';
}

// ── Popover: add child ────────────────────────────────────────────────────────

function openAddChild(parentNode, anchor) {
  closePopover();
  activeId = `add-${parentNode.id}`;

  const pop = document.createElement('div');
  pop.className = 'bp-popover';
  pop.dataset.popover = 'add';

  const title = document.createElement('div');
  title.className = 'bp-pop-title';
  title.textContent = 'Add child';
  pop.appendChild(title);

  // Choice
  const choices = document.createElement('div');
  choices.className = 'bp-pop-choices';

  const folderBtn = document.createElement('button');
  folderBtn.className = 'bp-pop-choice';
  folderBtn.innerHTML = '📁<span>Folder</span>';
  folderBtn.addEventListener('click', () => {
    parentNode.children.push(newFolder());
    closePopover();
    renderTree();
  });

  const fileBtn = document.createElement('button');
  fileBtn.className = 'bp-pop-choice';
  fileBtn.innerHTML = '📄<span>File</span>';
  fileBtn.addEventListener('click', () => {
    parentNode.children.push(newFile());
    closePopover();
    renderTree();
  });

  choices.appendChild(folderBtn);
  choices.appendChild(fileBtn);
  pop.appendChild(choices);

  positionPopover(pop, anchor);
  popover = pop;
}

function closePopover() {
  if (popover) { popover.remove(); popover = null; }
  activeId = null;
  document.querySelectorAll('.bp-card-active').forEach(el => el.classList.remove('bp-card-active'));
}

function onOutsideClick(e) {
  if (!popover) return;
  if (!popover.contains(e.target) && !e.target.closest('.bp-card') && !e.target.closest('.bp-add-child')) {
    closePopover();
  }
}

// ── Refresh a single node in place (name/lang/owner change) ──────────────────

function refreshNode(node) {
  const el = document.querySelector(`.bp-node[data-id="${node.id}"] .bp-card`);
  if (!el) return;

  const nameEl  = el.querySelector('.bp-node-name');
  const fnsEl   = el.querySelector('.bp-node-fns');
  const ownerEl = el.querySelector('.bp-node-owner');

  if (nameEl) {
    nameEl.textContent = node.kind === 'folder'
      ? node.name + (node.lang ? `  [${node.lang}]` : '')
      : node.name + '.bu';
  }

  if (node.kind === 'file') {
    if (node.fns.length) {
      if (fnsEl) { fnsEl.textContent = node.fns.join(', '); }
      else {
        const f = document.createElement('div');
        f.className = 'bp-node-fns';
        f.textContent = node.fns.join(', ');
        el.appendChild(f);
      }
    } else if (fnsEl) { fnsEl.remove(); }
  }

  if (node.owner) {
    if (ownerEl) { ownerEl.textContent = `@${node.owner}`; }
    else {
      const o = document.createElement('div');
      o.className = 'bp-node-owner';
      o.textContent = `@${node.owner}`;
      el.appendChild(o);
    }
  } else if (ownerEl) { ownerEl.remove(); }
}

// ── Canvas connectors ─────────────────────────────────────────────────────────

function drawConnectors(levels, nodeEls) {
  if (!canvasEl || !renderRoot) return;

  const stageRect = renderRoot.closest('.bp-stage').getBoundingClientRect();
  canvasEl.width  = stageRect.width;
  canvasEl.height = stageRect.height;

  const ctx = canvasEl.getContext('2d');
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  ctx.strokeStyle = 'rgba(74, 158, 255, 0.35)';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([4, 4]);

  for (let li = 0; li < levels.length - 1; li++) {
    for (const { node } of levels[li]) {
      if (node.kind !== 'folder') continue;
      const parentEl = nodeEls[node.id];
      if (!parentEl) continue;
      const parentRect = parentEl.getBoundingClientRect();
      const px = parentRect.left + parentRect.width / 2 - stageRect.left;
      const py = parentRect.bottom - stageRect.top;

      for (const child of node.children) {
        const childEl = nodeEls[child.id];
        if (!childEl) continue;
        const childRect = childEl.getBoundingClientRect();
        const cx = childRect.left + childRect.width / 2 - stageRect.left;
        const cy = childRect.top - stageRect.top;

        ctx.beginPath();
        ctx.moveTo(px, py);
        // Cubic bezier for smooth curve
        ctx.bezierCurveTo(px, py + (cy - py) * 0.5, cx, py + (cy - py) * 0.5, cx, cy);
        ctx.stroke();
      }
    }
  }
}

// Re-draw connectors on resize
window.addEventListener('resize', () => {
  if (!tree || !renderRoot) return;
  const levels  = [];
  let current   = [{ node: tree, parentId: null }];
  const nodeEls = {};
  while (current.length) {
    levels.push(current);
    const next = [];
    for (const { node } of current) {
      const el = document.querySelector(`.bp-node[data-id="${node.id}"]`);
      if (el) nodeEls[node.id] = el;
      if (node.kind === 'folder') {
        for (const c of node.children) next.push({ node: c, parentId: node.id });
      }
    }
    current = next;
  }
  requestAnimationFrame(() => drawConnectors(levels, nodeEls));
});
