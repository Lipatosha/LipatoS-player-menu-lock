const MODULE_ID = "lipatos-player-menu-lock";
const VERSION = "1.3.1";

function isPlayer() {
  return !!game.user && !game.user.isGM;
}

function norm(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function localized(value) {
  if (typeof value !== "string") return "";
  try {
    const translated = game.i18n?.localize(value);
    return translated && translated !== value ? translated : value;
  } catch {
    return value;
  }
}

const ITEM_BLOCKED_KEYS = new Set([
  "DND5E.Scroll.CreateScroll",
  "DND5E.ContextMenuActionDelete"
]);

const ITEM_BLOCKED_PHRASES = [
  "передать предмет",
  "создание свитка",
  "создать свиток",
  "удалить",
  "transfer item",
  "create scroll",
  "delete"
];

const EFFECT_BLOCKED_PHRASES = ["удалить", "delete"];

const ITEM_BLOCKED_IDS = new Set([
  "transfer", "transferitem", "itemtransfer",
  "createscroll", "scrollcreate",
  "delete", "itemdelete"
]);

function compact(value) {
  return norm(value).replace(/\s+/g, "");
}

function phraseBlocked(value, phrases) {
  const text = norm(value);
  if (!text) return false;
  return phrases.some(word => {
    const w = norm(word);
    return text === w || text.startsWith(`${w} `) || text.includes(` ${w} `);
  });
}

function isBlockedItemEntry(entry) {
  if (!entry) return false;
  if (typeof entry.label === "string" && ITEM_BLOCKED_KEYS.has(entry.label)) return true;

  const identifiers = [entry.id, entry.action, entry.name, entry.key, entry.command]
    .map(compact)
    .filter(Boolean);
  if (identifiers.some(id => ITEM_BLOCKED_IDS.has(id))) return true;

  const labels = [entry.label, localized(entry.label), entry.title, localized(entry.title), entry.name, localized(entry.name)];
  if (labels.some(label => phraseBlocked(label, ITEM_BLOCKED_PHRASES))) return true;

  const icon = norm(entry.icon);
  if (icon.includes("fa trash") || icon.includes("fa-trash")) return true;
  return false;
}

function isBlockedEffectEntry(entry) {
  if (!entry) return false;
  const labels = [entry.label, localized(entry.label), entry.title, localized(entry.title), entry.name, localized(entry.name)];
  if (labels.some(label => phraseBlocked(label, EFFECT_BLOCKED_PHRASES))) return true;
  const id = compact(entry.id ?? entry.action ?? entry.name ?? entry.key ?? "");
  if (["delete", "remove", "effectdelete", "deleteeffect"].includes(id)) return true;
  const icon = norm(entry.icon);
  return icon.includes("fa trash") || icon.includes("fa-trash");
}

function stripOptions(options, scope) {
  if (!isPlayer() || !Array.isArray(options)) return options;
  const blocked = scope === "effect" ? isBlockedEffectEntry : isBlockedItemEntry;
  for (let i = options.length - 1; i >= 0; i--) {
    if (blocked(options[i])) options.splice(i, 1);
  }
  return options;
}

function inventoryScope(inventory, element) {
  const activeTab = inventory?.app?.tabGroups?.primary;
  if (activeTab === "features" || activeTab === "spells") return "item";
  if (element instanceof HTMLElement && element.closest('[data-tab="features"], [data-tab="spells"]')) return "item";
  return null;
}

let activeScope = null;
let scopeTimer = null;

function armScope(scope) {
  if (!isPlayer() || !scope) return;
  activeScope = scope;
  clearTimeout(scopeTimer);
  scopeTimer = setTimeout(() => { activeScope = null; }, 2200);

  queueMicrotask(() => filterOpenContext(scope));
  requestAnimationFrame(() => filterOpenContext(scope));
  setTimeout(() => filterOpenContext(scope), 0);
  setTimeout(() => filterOpenContext(scope), 40);
  setTimeout(() => filterOpenContext(scope), 120);
  setTimeout(() => filterOpenContext(scope), 300);
}

function getScopeFromTarget(target) {
  if (!(target instanceof Element)) return null;
  if (target.closest('dnd5e-effects')) return "effect";
  if (target.closest('[data-tab="features"], [data-tab="spells"]')) return "item";
  return null;
}

function menuTextBlocked(text, scope) {
  const phrases = scope === "effect" ? EFFECT_BLOCKED_PHRASES : ITEM_BLOCKED_PHRASES;
  return phraseBlocked(text, phrases);
}

function stripMenuDom(root, scope) {
  if (!isPlayer() || !scope || !(root instanceof Element || root instanceof Document)) return;

  const selectors = [
    '.context-item',
    '.menu-item',
    '[role="menuitem"]',
    'li',
    'button'
  ].join(',');

  const candidates = [];
  if (root instanceof Element && root.matches?.(selectors)) candidates.push(root);
  candidates.push(...root.querySelectorAll?.(selectors) ?? []);

  for (const node of candidates) {
    if (!(node instanceof Element)) continue;
    const text = norm(node.textContent);
    if (!text || !menuTextBlocked(text, scope)) continue;

    const row = node.closest('.context-item, .menu-item, [role="menuitem"], li') ?? node;
    row.remove();
  }
}

function filterOpenContext(scope = activeScope) {
  if (!isPlayer() || !scope) return;

  stripOptions(ui.context?.menuItems, scope);
  stripOptions(ui.context?.options, scope);

  const roots = document.querySelectorAll(
    '.context-menu, #context-menu, [role="menu"], .menu-items, .context-items'
  );
  for (const root of roots) stripMenuDom(root, scope);
}

async function patchInventoryElement() {
  await customElements.whenDefined("dnd5e-inventory");
  const Inventory = customElements.get("dnd5e-inventory");
  const proto = Inventory?.prototype;
  if (!proto || proto._lipatosMenuLockPatched) return;

  const original = proto._onOpenContextMenu;
  if (typeof original !== "function") return;

  Object.defineProperty(proto, "_lipatosMenuLockPatched", { value: true, configurable: true });

  proto._onOpenContextMenu = function(element, ...args) {
    const scope = inventoryScope(this, element);
    if (scope) armScope(scope);
    const result = original.call(this, element, ...args);
    if (scope) armScope(scope);
    return result;
  };
}

async function patchEffectsElement() {
  await customElements.whenDefined("dnd5e-effects");
  const Effects = customElements.get("dnd5e-effects");
  const proto = Effects?.prototype;
  if (!proto || proto._lipatosMenuLockPatched) return;

  const originalOpen = proto._onOpenContextMenu;
  if (typeof originalOpen === "function") {
    const wrapped = originalOpen;
    proto._onOpenContextMenu = function(element, ...args) {
      armScope("effect");
      const result = wrapped.call(this, element, ...args);
      armScope("effect");
      return result;
    };
  }

  const originalGet = proto._getContextOptions;
  if (typeof originalGet === "function") {
    proto._getContextOptions = function(effect, ...args) {
      const options = originalGet.call(this, effect, ...args);
      if (isPlayer()) stripOptions(options, "effect");
      return options;
    };
  }

  Object.defineProperty(proto, "_lipatosMenuLockPatched", { value: true, configurable: true });
}

function installHookFilters() {
  Hooks.on("dnd5e.getItemContextOptions", (item, options) => {
    if (!isPlayer() || !item?.actor) return;
    if (item.type === "spell" || ["feat", "class", "subclass", "background", "race"].includes(item.type)) {
      stripOptions(options, "item");
      armScope("item");
    }
  });

  Hooks.on("dnd5e.getActiveEffectContextOptions", (effect, options) => {
    if (!isPlayer()) return;
    const parent = effect?.parent;
    if (parent?.documentName === "Actor" || (typeof Actor !== "undefined" && parent instanceof Actor)) {
      stripOptions(options, "effect");
      armScope("effect");
    }
  });
}

function installDomSafetyNet() {
  document.addEventListener("contextmenu", event => {
    const scope = getScopeFromTarget(event.target);
    if (scope) armScope(scope);
  }, true);

  document.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    const scope = getScopeFromTarget(event.target);
    if (scope) armScope(scope);
  }, true);

  const observer = new MutationObserver(mutations => {
    if (!activeScope || !isPlayer()) return;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) stripMenuDom(node, activeScope);
      }
    }
    filterOpenContext(activeScope);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
}

Hooks.once("ready", () => {
  if (!isPlayer()) return;
  installHookFilters();
  installDomSafetyNet();
  void patchInventoryElement();
  void patchEffectsElement();
  console.log(`${MODULE_ID} | ${VERSION} ready`);
});
