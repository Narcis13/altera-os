/**
 * Loom Core v0.1.0
 * Alpine-style reactivity for the Loom UI component system.
 * Zero dependencies. CDN-ready. Agent-native.
 *
 * Usage:
 *   <script src="loom-core.js"></script>
 *   — or —
 *   <script src="loom-core.js" type="module"></script>
 *   — or —
 *   import Loom from './loom-core.js'
 */
(function(global, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    var Loom = factory();
    global.Loom = Loom;
    if (typeof globalThis !== 'undefined') globalThis.Loom = Loom;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // ═══════════════════════════════════════════════════════
  // Section 1: Reactive Engine
  // ═══════════════════════════════════════════════════════

  let currentEffect = null;
  const effectStack = [];
  let batchDepth = 0;
  const pendingEffects = new Set();
  let flushScheduled = false;

  const reactiveMap = new WeakMap();
  const ARRAY_MUTATORS = new Set(['push', 'pop', 'splice', 'shift', 'unshift', 'sort', 'reverse']);

  function reactive(obj) {
    if (obj.__isReactive) return obj;
    if (reactiveMap.has(obj)) return reactiveMap.get(obj);

    const deps = Object.create(null);

    const proxy = new Proxy(obj, {
      get(target, key, receiver) {
        if (key === '__isReactive') return true;
        if (key === '__deps') return deps;
        if (key === '__target') return target;

        if (currentEffect && typeof key === 'string') {
          if (!deps[key]) deps[key] = new Set();
          deps[key].add(currentEffect);
          currentEffect._deps.add(deps[key]);
        }

        const value = Reflect.get(target, key, receiver);

        // Intercept array mutation methods to trigger 'length' deps,
        // since internal length updates bypass the setter's change check.
        if (Array.isArray(target) && typeof value === 'function' && ARRAY_MUTATORS.has(key)) {
          return function() {
            const result = value.apply(target, arguments);
            if (deps['length']) {
              for (const eff of deps['length']) {
                pendingEffects.add(eff);
              }
              scheduleFlush();
            }
            return result;
          };
        }

        // Deep reactivity: wrap nested arrays and plain objects so that
        // mutations like array.push() / array.splice() trigger effects.
        if (value !== null && typeof value === 'object'
            && !value.__isReactive
            && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype)) {
          return reactive(value);
        }

        return value;
      },

      set(target, key, value, receiver) {
        const oldValue = target[key];
        const result = Reflect.set(target, key, value, receiver);

        if (oldValue !== value && deps[key]) {
          for (const eff of deps[key]) {
            pendingEffects.add(eff);
          }
          scheduleFlush();
        }

        return result;
      }
    });

    reactiveMap.set(obj, proxy);
    return proxy;
  }

  function effect(fn) {
    const execute = () => {
      cleanup(execute);

      currentEffect = execute;
      effectStack.push(execute);

      try {
        fn();
      } finally {
        effectStack.pop();
        currentEffect = effectStack[effectStack.length - 1] || null;
      }
    };

    execute._deps = new Set();
    execute();

    return () => cleanup(execute);
  }

  function cleanup(execute) {
    for (const depSet of execute._deps) {
      depSet.delete(execute);
    }
    execute._deps.clear();
  }

  function scheduleFlush() {
    if (batchDepth > 0) return;
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(flushEffects);
  }

  function flushEffects() {
    flushScheduled = false;
    const effects = [...pendingEffects];
    pendingEffects.clear();
    for (const eff of effects) {
      eff();
    }
  }

  function batch(fn) {
    batchDepth++;
    try {
      fn();
    } finally {
      batchDepth--;
      if (batchDepth === 0) {
        flushEffects();
      }
    }
  }

  function untrack(fn) {
    const prev = currentEffect;
    currentEffect = null;
    try {
      return fn();
    } finally {
      currentEffect = prev;
    }
  }

  // ═══════════════════════════════════════════════════════
  // Section 2: Expression Evaluator
  // ═══════════════════════════════════════════════════════

  const expressionCache = new Map();

  function evaluate(expression, scope, el) {
    try {
      const fn = compileExpression(expression);
      return fn.call(scope, scope, el);
    } catch (e) {
      console.warn('[Loom] Expression error: "' + expression + '"', e);
      return undefined;
    }
  }

  function evaluateAssignment(expression, scope, el) {
    try {
      const fn = compileStatement(expression);
      fn.call(scope, scope, el);
    } catch (e) {
      console.warn('[Loom] Statement error: "' + expression + '"', e);
    }
  }

  function compileExpression(expr) {
    var key = 'expr:' + expr;
    if (expressionCache.has(key)) return expressionCache.get(key);

    var fn = new Function(
      '$scope', '$el',
      'with($scope) { return (' + expr + ') }'
    );
    expressionCache.set(key, fn);
    return fn;
  }

  function compileStatement(expr) {
    var key = 'stmt:' + expr;
    if (expressionCache.has(key)) return expressionCache.get(key);

    var fn = new Function(
      '$scope', '$el',
      'with($scope) { ' + expr + ' }'
    );
    expressionCache.set(key, fn);
    return fn;
  }

  // ═══════════════════════════════════════════════════════
  // Section 3: Directive System
  // ═══════════════════════════════════════════════════════

  // --- Shared state ---
  var scopeCounter = 0;
  var dataRegistry = new Map();
  var customDirectives = new Map();
  var globalStores = {};

  // --- 3.1 Attribute Parsing ---

  function parseDirectives(el) {
    var directives = [];

    for (var i = 0; i < el.attributes.length; i++) {
      var attr = el.attributes[i];
      var name = attr.name;
      var directive = null;

      if (name.startsWith('l-')) {
        if (name.startsWith('l-bind:')) {
          var rest = name.slice(7);
          var parts = rest.split('.');
          directive = {
            type: 'bind',
            arg: parts[0],
            expression: attr.value,
            modifiers: parts.slice(1),
            raw: name
          };
        } else if (name.startsWith('l-on:')) {
          var rest = name.slice(5);
          var parts = rest.split('.');
          directive = {
            type: 'on',
            arg: parts[0],
            expression: attr.value,
            modifiers: parts.slice(1),
            raw: name
          };
        } else if (name.startsWith('l-source:')) {
          var rest = name.slice(9);
          var parts = rest.split('.');
          directive = {
            type: 'source',
            arg: parts[0],
            expression: attr.value,
            modifiers: parts.slice(1),
            raw: name
          };
        } else {
          var rest = name.slice(2);
          var parts = rest.split('.');
          directive = {
            type: parts[0],
            expression: attr.value,
            modifiers: parts.slice(1),
            raw: name
          };
        }
      } else if (name.startsWith(':')) {
        var rest = name.slice(1);
        var parts = rest.split('.');
        directive = {
          type: 'bind',
          arg: parts[0],
          expression: attr.value,
          modifiers: parts.slice(1),
          raw: name
        };
      } else if (name.startsWith('@')) {
        var rest = name.slice(1);
        var parts = rest.split('.');
        directive = {
          type: 'on',
          arg: parts[0],
          expression: attr.value,
          modifiers: parts.slice(1),
          raw: name
        };
      }

      if (directive) directives.push(directive);
    }

    return directives;
  }

  // --- 3.2 Directive Priority ---

  var PRIORITY = {
    'data': 1,
    'source': 1,
    'for': 2,
    'if': 3,
    'bind': 10,
    'on': 10,
    'text': 10,
    'html': 10,
    'model': 10,
    'show': 10,
    'transition': 10,
    'ref': 10,
    'init': 20,
    'effect': 20,
    'cloak': 100,
    'teleport': 100
  };

  // --- 3.3 DOM Tree Walker ---

  function initTree(root, parentScope) {
    var scope = initScope(root, parentScope);
    walkChildren(root, scope);
  }

  function walkChildren(el, scope) {
    var children = [].slice.call(el.children);
    for (var i = 0; i < children.length; i++) {
      var child = children[i];

      // Skip elements already initialized by l-for or l-if
      if (child.__loomScope && !child.hasAttribute('l-data')) {
        continue;
      }

      // Only l-data creates a new scope boundary.
      // data-ui elements inherit the parent scope so directives
      // inside Loom components can access the enclosing reactive data.
      if (child.hasAttribute('l-data')) {
        initTree(child, scope);
        continue;
      }

      processElement(child, scope);
      // Skip walkChildren if structural directive (l-if/l-for) removed the element
      if (child.parentNode) {
        walkChildren(child, scope);
      }
    }
  }

  function processElement(el, scope) {
    var directives = parseDirectives(el);
    if (directives.length === 0) return;

    directives.sort(function(a, b) {
      return (PRIORITY[a.type] || 10) - (PRIORITY[b.type] || 10);
    });

    // Structural directives take over the element
    for (var i = 0; i < directives.length; i++) {
      if (directives[i].type === 'if') {
        handleIf(el, directives[i], scope);
        return;
      }
      if (directives[i].type === 'for') {
        handleFor(el, directives[i], scope);
        return;
      }
    }

    for (var i = 0; i < directives.length; i++) {
      applyDirective(el, directives[i], scope);
    }
  }

  // --- 3.4 l-data / Scope Initialization ---

  function initScope(root, parentScope) {
    var expr = root.getAttribute('l-data');
    var userData = {};

    if (expr) {
      if (dataRegistry.has(expr)) {
        userData = dataRegistry.get(expr)();
      } else if (expr.trim()) {
        userData = evaluate(expr, parentScope || {}, root) || {};
      }
    }

    var propData = readProps(root);
    Object.assign(userData, propData);

    var scopeId = ++scopeCounter;
    var scope = createScopeWithMagics(userData, root, root);
    root.__loomScope = scope;
    root.__scopeId = scopeId;
    root.__loomCleanups = [];

    // Set up bidirectional bridge for $state/$variant
    setupStateBridge(root, scope);

    // Process l-source directives (inject data + controller into scope)
    processSourceDirectives(root, scope);

    var initExpr = root.getAttribute('l-init');
    if (initExpr) {
      evaluateAssignment(initExpr, scope, root);
    }

    return scope;
  }

  function readProps(el) {
    var props = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var attr = el.attributes[i];
      if (attr.name.startsWith('data-prop-')) {
        var key = attr.name.slice(10).replace(/-([a-z])/g, function(_, c) { return c.toUpperCase(); });
        try {
          props[key] = JSON.parse(attr.value);
        } catch (e) {
          props[key] = attr.value;
        }
      }
    }
    return props;
  }

  function createScopeWithMagics(data, el, root) {
    var magics = Object.create(null);

    Object.defineProperties(magics, {
      $el: { get: function() { return el; }, enumerable: false },
      $refs: { get: function() { return getScopeRefs(root); }, enumerable: false },
      $store: { get: function() { return globalStores; }, enumerable: false },
      $state: {
        get: function() { return closestUI(el) ? closestUI(el).dataset.state : undefined; },
        set: function(v) { var ui = closestUI(el); if (ui) ui.dataset.state = v; },
        enumerable: false
      },
      $variant: {
        get: function() { return closestUI(el) ? closestUI(el).dataset.variant : undefined; },
        set: function(v) { var ui = closestUI(el); if (ui) ui.dataset.variant = v; },
        enumerable: false
      },
      $ui: { get: function() { return getControllerApi(closestUI(el)); }, enumerable: false },
      $dispatch: {
        value: function(event, detail) {
          return el.dispatchEvent(
            new CustomEvent(event, { detail: detail, bubbles: true, composed: true })
          );
        },
        enumerable: false
      },
      $nextTick: {
        value: function(fn) { return queueMicrotask(fn || function() {}); },
        enumerable: false
      },
      $watch: {
        value: function(key, cb) { return watchProperty(scope, key, cb); },
        enumerable: false
      },
      $id: {
        value: function(name) { return 'loom-' + root.__scopeId + '-' + name; },
        enumerable: false
      }
    });

    // Use defineProperties instead of Object.assign to preserve getters/setters
    // (Object.assign invokes getters and copies the result as a static value).
    var target = Object.create(magics);
    var descriptors = Object.getOwnPropertyDescriptors(data);
    Object.defineProperties(target, descriptors);

    var scope = reactive(target);
    return scope;
  }

  function watchProperty(scope, key, cb) {
    var oldValue = scope[key];
    var dispose = effect(function() {
      var newValue = scope[key];
      if (newValue !== oldValue) {
        var prev = oldValue;
        oldValue = newValue;
        cb(newValue, prev);
      }
    });
    return dispose;
  }

  // --- Scope utilities ---

  function getScopeRefs(root) {
    return root.__loomRefs || {};
  }

  function findScopeRoot(el) {
    var node = el;
    while (node) {
      if (node.__loomScope) return node;
      node = node.parentElement;
    }
    return el;
  }

  function addCleanup(el, cleanupFn) {
    var root = findScopeRoot(el);
    if (root && root.__loomCleanups) {
      root.__loomCleanups.push(cleanupFn);
    }
  }

  function destroyScope(el) {
    if (el.__loomCleanups) {
      for (var i = 0; i < el.__loomCleanups.length; i++) {
        el.__loomCleanups[i]();
      }
      el.__loomCleanups = [];
    }
    var children = el.querySelectorAll ? el.querySelectorAll('*') : [];
    for (var i = 0; i < children.length; i++) {
      if (children[i].__loomCleanups) {
        for (var j = 0; j < children[i].__loomCleanups.length; j++) {
          children[i].__loomCleanups[j]();
        }
        children[i].__loomCleanups = [];
      }
    }
  }

  // --- 3.5 l-source Directive ---

  function processSourceDirectives(root, scope) {
    for (var i = 0; i < root.attributes.length; i++) {
      var attr = root.attributes[i];
      if (!attr.name.startsWith('l-source:')) continue;

      var rest = attr.name.slice(9);
      var parts = rest.split('.');
      var sourceName = parts[0];
      var modifiers = parts.slice(1);
      var endpoint = attr.value;

      var opts = parseSourceModifiers(modifiers);
      setupSource(scope, root, sourceName, endpoint, opts);
    }
  }

  function parseSourceModifiers(modifiers) {
    var opts = { lazy: false, optimistic: false, idKey: 'id', pollInterval: 0 };

    for (var i = 0; i < modifiers.length; i++) {
      var mod = modifiers[i];
      if (mod === 'lazy') {
        opts.lazy = true;
      } else if (mod === 'optimistic') {
        opts.optimistic = true;
      } else if (mod === 'poll') {
        // Next modifier may be the interval in ms
        var next = modifiers[i + 1];
        if (next && /^\d+$/.test(next)) {
          opts.pollInterval = parseInt(next, 10);
          i++; // skip the number
        } else {
          opts.pollInterval = 30000; // default 30s
        }
      } else if (mod === 'key') {
        // Next modifier is the key name
        var next = modifiers[i + 1];
        if (next && !/^\d+$/.test(next)) {
          opts.idKey = next;
          i++; // skip the key name
        }
      }
    }

    return opts;
  }

  function setupSource(scope, root, name, endpoint, opts) {
    var pollTimer = null;
    var idKey = opts.idKey;
    var isOptimistic = opts.optimistic;

    // Inject reactive data properties into scope
    scope[name] = [];
    scope[name + 'Loading'] = false;
    scope[name + 'Error'] = null;

    // CRUD controller
    var ctrl = {
      load: function() {
        scope[name + 'Loading'] = true;
        scope[name + 'Error'] = null;
        return fetch(endpoint)
          .then(function(res) {
            if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
            return res.json();
          })
          .then(function(data) {
            scope[name] = Array.isArray(data) ? data : [data];
          })
          .catch(function(e) {
            scope[name + 'Error'] = e.message;
          })
          .then(function() {
            scope[name + 'Loading'] = false;
          });
      },

      create: function(payload) {
        scope[name + 'Error'] = null;
        var tempIndex = -1;

        if (isOptimistic) {
          var temp = Object.assign({}, payload, { _pending: true });
          scope[name].push(temp);
          tempIndex = scope[name].length - 1;
        }

        return fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        .then(function(res) {
          if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
          return res.json();
        })
        .then(function(created) {
          if (isOptimistic && tempIndex >= 0) {
            scope[name][tempIndex] = created;
          } else {
            scope[name].push(created);
          }
          return created;
        })
        .catch(function(e) {
          scope[name + 'Error'] = e.message;
          if (isOptimistic && tempIndex >= 0) {
            scope[name].splice(tempIndex, 1);
          }
          return null;
        });
      },

      update: function(id, payload) {
        scope[name + 'Error'] = null;
        var items = scope[name];
        var idx = -1;
        for (var i = 0; i < items.length; i++) {
          if (items[i][idKey] === id) { idx = i; break; }
        }
        var snapshot = null;

        if (isOptimistic && idx >= 0) {
          snapshot = Object.assign({}, items[idx]);
          Object.assign(items[idx], payload);
        }

        return fetch(endpoint + '/' + id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        .then(function(res) {
          if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
          return res.json();
        })
        .then(function(updated) {
          if (idx >= 0) scope[name][idx] = updated;
          return updated;
        })
        .catch(function(e) {
          scope[name + 'Error'] = e.message;
          if (isOptimistic && snapshot && idx >= 0) {
            scope[name][idx] = snapshot;
          }
          return null;
        });
      },

      remove: function(id) {
        scope[name + 'Error'] = null;
        var items = scope[name];
        var idx = -1;
        for (var i = 0; i < items.length; i++) {
          if (items[i][idKey] === id) { idx = i; break; }
        }
        var snapshot = null;

        if (isOptimistic && idx >= 0) {
          snapshot = items[idx];
          items.splice(idx, 1);
        }

        return fetch(endpoint + '/' + id, { method: 'DELETE' })
        .then(function(res) {
          if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
          if (!isOptimistic && idx >= 0) {
            scope[name].splice(idx, 1);
          }
        })
        .catch(function(e) {
          scope[name + 'Error'] = e.message;
          if (isOptimistic && snapshot) {
            scope[name].splice(idx, 0, snapshot);
          }
        });
      },

      refresh: function() { return ctrl.load(); },

      startPolling: function(interval) {
        ctrl.stopPolling();
        var ms = interval || opts.pollInterval || 30000;
        pollTimer = setInterval(function() { ctrl.load(); }, ms);
      },

      stopPolling: function() {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      }
    };

    // Inject controller as $name
    scope['$' + name] = ctrl;

    // Auto-load unless .lazy
    if (!opts.lazy) {
      ctrl.load();
    }

    // Auto-poll if .poll modifier present
    if (opts.pollInterval > 0) {
      ctrl.startPolling();
    }

    // Cleanup polling on scope destruction
    addCleanup(root, function() { ctrl.stopPolling(); });
  }

  // --- 3.6 Directive Dispatch ---

  function applyDirective(el, dir, scope) {
    switch (dir.type) {
      case 'bind':       return handleBind(el, dir, scope);
      case 'on':         return handleOn(el, dir, scope);
      case 'text':       return handleText(el, dir, scope);
      case 'html':       return handleHtml(el, dir, scope);
      case 'model':      return handleModel(el, dir, scope);
      case 'show':       return handleShow(el, dir, scope);
      case 'ref':        return handleRef(el, dir, scope);
      case 'init':       return handleInit(el, dir, scope);
      case 'effect':     return handleEffect(el, dir, scope);
      case 'source':     return; // Handled by initScope → processSourceDirectives
      case 'cloak':      return; // Handled by removeCloaks()
      case 'teleport':   return handleTeleport(el, dir, scope);
      case 'transition': return; // Handled by l-show and l-if
      default:
        if (customDirectives.has(dir.type)) {
          customDirectives.get(dir.type)(el, dir, scope);
        }
    }
  }

  // --- 3.6 l-text ---

  function handleText(el, dir, scope) {
    var cl = effect(function() {
      var value = evaluate(dir.expression, scope, el);
      el.textContent = value == null ? '' : String(value);
    });
    addCleanup(el, cl);
  }

  // --- 3.7 l-html ---

  function handleHtml(el, dir, scope) {
    var cl = effect(function() {
      var value = evaluate(dir.expression, scope, el);
      el.innerHTML = value == null ? '' : String(value);
    });
    addCleanup(el, cl);
  }

  // --- 3.8 l-bind / :attr ---

  var BOOLEAN_ATTRS = new Set([
    'disabled', 'hidden', 'checked', 'readonly', 'required', 'selected',
    'autofocus', 'autoplay', 'controls', 'loop', 'muted', 'multiple',
    'open', 'novalidate', 'formnovalidate', 'inert'
  ]);

  function handleBind(el, dir, scope) {
    var attrName = dir.arg;

    var cl = effect(function() {
      var value = evaluate(dir.expression, scope, el);

      if (attrName === 'class') {
        applyClassBinding(el, value);
      } else if (attrName === 'style') {
        applyStyleBinding(el, value);
      } else if (BOOLEAN_ATTRS.has(attrName)) {
        if (value) {
          el.setAttribute(attrName, '');
        } else {
          el.removeAttribute(attrName);
        }
      } else {
        if (value === null || value === undefined || value === false) {
          el.removeAttribute(attrName);
        } else {
          el.setAttribute(attrName, String(value));
        }
      }
    });

    addCleanup(el, cl);
  }

  function applyClassBinding(el, value) {
    if (typeof value === 'string') {
      el.className = value;
    } else if (Array.isArray(value)) {
      el.className = value.filter(Boolean).join(' ');
    } else if (typeof value === 'object' && value !== null) {
      for (var cls in value) {
        if (value.hasOwnProperty(cls)) {
          el.classList.toggle(cls, !!value[cls]);
        }
      }
    }
  }

  function applyStyleBinding(el, value) {
    if (typeof value === 'string') {
      el.style.cssText = value;
    } else if (typeof value === 'object' && value !== null) {
      for (var prop in value) {
        if (value.hasOwnProperty(prop)) {
          var cssProp = prop.replace(/[A-Z]/g, function(m) { return '-' + m.toLowerCase(); });
          var val = value[prop];
          if (val === null || val === undefined || val === false) {
            el.style.removeProperty(cssProp);
          } else {
            el.style.setProperty(cssProp, String(val));
          }
        }
      }
    }
  }

  // --- 3.9 l-on / @event ---

  var KEY_MAP = {
    'enter': 'Enter', 'escape': 'Escape', 'esc': 'Escape',
    'tab': 'Tab', 'space': ' ', 'delete': 'Delete', 'backspace': 'Backspace',
    'up': 'ArrowUp', 'down': 'ArrowDown', 'left': 'ArrowLeft', 'right': 'ArrowRight',
    'arrow-up': 'ArrowUp', 'arrow-down': 'ArrowDown',
    'arrow-left': 'ArrowLeft', 'arrow-right': 'ArrowRight',
    'home': 'Home', 'end': 'End', 'page-up': 'PageUp', 'page-down': 'PageDown'
  };

  function debounce(fn, ms) {
    var timer;
    return function() {
      var self = this, args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function() { fn.apply(self, args); }, ms);
    };
  }

  function throttle(fn, ms) {
    var last = 0;
    return function() {
      var now = Date.now();
      if (now - last >= ms) {
        last = now;
        fn.apply(this, arguments);
      }
    };
  }

  function parseTimeMod(mod) {
    var match = mod.match(/(\d+)(ms|s)?/);
    if (!match) return null;
    var value = parseInt(match[1], 10);
    return match[2] === 's' ? value * 1000 : value;
  }

  function handleOn(el, dir, scope) {
    var eventName = dir.arg;
    var modifiers = new Set(dir.modifiers);

    var target = el;
    if (modifiers.has('window')) target = window;
    else if (modifiers.has('document')) target = document;

    var wrapFn = null;
    for (var m = 0; m < dir.modifiers.length; m++) {
      var mod = dir.modifiers[m];
      if (mod.startsWith('debounce')) {
        var ms = parseTimeMod(mod) || 250;
        wrapFn = function(fn) { return debounce(fn, ms); };
      } else if (mod.startsWith('throttle')) {
        var ms = parseTimeMod(mod) || 250;
        wrapFn = function(fn) { return throttle(fn, ms); };
      }
    }

    var isKey = eventName === 'keydown' || eventName === 'keyup' || eventName === 'keypress';
    var keyTarget = null;
    if (isKey) {
      for (var m = 0; m < dir.modifiers.length; m++) {
        if (KEY_MAP[dir.modifiers[m]]) {
          keyTarget = KEY_MAP[dir.modifiers[m]];
          break;
        }
      }
    }

    var handler = function(e) {
      if (modifiers.has('prevent')) e.preventDefault();
      if (modifiers.has('stop')) e.stopPropagation();
      if (modifiers.has('self') && e.target !== el) return;

      if (keyTarget && e.key !== keyTarget) return;

      scope.$event = e;
      try {
        evaluateAssignment(dir.expression, scope, el);
      } finally {
        delete scope.$event;
      }
    };

    if (wrapFn) handler = wrapFn(handler);

    var options = {};
    if (modifiers.has('once')) options.once = true;
    if (modifiers.has('capture')) options.capture = true;
    if (modifiers.has('passive')) options.passive = true;

    target.addEventListener(eventName, handler, options);
    addCleanup(el, function() { target.removeEventListener(eventName, handler, options); });
  }

  // --- 3.10 l-ref ---

  function handleRef(el, dir, scope) {
    var name = dir.expression;
    var root = findScopeRoot(el);
    if (!root.__loomRefs) root.__loomRefs = {};
    root.__loomRefs[name] = el;

    addCleanup(el, function() {
      if (root.__loomRefs && root.__loomRefs[name] === el) {
        delete root.__loomRefs[name];
      }
    });
  }

  // --- 3.11 l-init ---

  function handleInit(el, dir, scope) {
    evaluateAssignment(dir.expression, scope, el);
  }

  // --- 3.12 l-effect ---

  function handleEffect(el, dir, scope) {
    var cl = effect(function() {
      evaluateAssignment(dir.expression, scope, el);
    });
    addCleanup(el, cl);
  }

  // --- 3.13 l-cloak ---

  function injectCloakStyle() {
    var style = document.createElement('style');
    style.textContent = '[l-cloak] { display: none !important; }';
    document.head.appendChild(style);
  }

  function removeCloaks() {
    var els = document.querySelectorAll('[l-cloak]');
    for (var i = 0; i < els.length; i++) {
      els[i].removeAttribute('l-cloak');
    }
  }

  // --- 3.14 l-transition helpers ---

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function runEnterTransition(el, name) {
    if (prefersReducedMotion()) return;
    var prefix = name || 'l';

    el.classList.add(prefix + '-enter-from', prefix + '-enter-active');
    el.offsetHeight; // force reflow

    requestAnimationFrame(function() {
      el.classList.remove(prefix + '-enter-from');
      el.classList.add(prefix + '-enter-to');

      var onEnd = function() {
        el.classList.remove(prefix + '-enter-active', prefix + '-enter-to');
        el.removeEventListener('transitionend', onEnd);
        el.removeEventListener('animationend', onEnd);
      };
      el.addEventListener('transitionend', onEnd, { once: true });
      el.addEventListener('animationend', onEnd, { once: true });
    });
  }

  function runLeaveTransition(el, name, done) {
    if (prefersReducedMotion()) { done(); return; }
    var prefix = name || 'l';

    el.classList.add(prefix + '-leave-from', prefix + '-leave-active');
    el.offsetHeight; // force reflow

    requestAnimationFrame(function() {
      el.classList.remove(prefix + '-leave-from');
      el.classList.add(prefix + '-leave-to');

      var onEnd = function() {
        el.classList.remove(prefix + '-leave-active', prefix + '-leave-to');
        el.removeEventListener('transitionend', onEnd);
        el.removeEventListener('animationend', onEnd);
        done();
      };
      el.addEventListener('transitionend', onEnd, { once: true });
      el.addEventListener('animationend', onEnd, { once: true });
    });
  }

  // --- 3.15 l-model ---

  function handleModel(el, dir, scope) {
    var prop = dir.expression;
    var modifiers = new Set(dir.modifiers);

    var tag = el.tagName.toLowerCase();
    var type = el.getAttribute('type');
    var isLoomSwitch = el.hasAttribute('data-ui') && el.dataset.ui === 'switch';

    if (isLoomSwitch) {
      var cl = effect(function() {
        var value = evaluate(prop, scope, el);
        el.checked = !!value;
        el.dataset.state = value ? 'on' : 'off';
        el.setAttribute('aria-checked', value ? 'true' : 'false');
      });
      el.addEventListener('change', function() {
        evaluateAssignment(prop + ' = ' + el.checked, scope, el);
      });
      addCleanup(el, cl);

    } else if (tag === 'input' && type === 'checkbox') {
      var cl = effect(function() {
        var current = evaluate(prop, scope, el);
        if (Array.isArray(current)) {
          el.checked = current.indexOf(el.value) >= 0;
        } else {
          el.checked = !!current;
        }
      });
      el.addEventListener('change', function() {
        var current = evaluate(prop, scope, el);
        if (Array.isArray(current)) {
          var arr = current.slice();
          var idx = arr.indexOf(el.value);
          if (el.checked && idx < 0) arr.push(el.value);
          else if (!el.checked && idx >= 0) arr.splice(idx, 1);
          evaluateAssignment(prop + ' = __arr', Object.create(scope, { __arr: { value: arr } }), el);
        } else {
          evaluateAssignment(prop + ' = ' + el.checked, scope, el);
        }
      });
      addCleanup(el, cl);

    } else if (tag === 'input' && type === 'radio') {
      var cl = effect(function() {
        el.checked = evaluate(prop, scope, el) === el.value;
      });
      el.addEventListener('change', function() {
        if (el.checked) {
          evaluateAssignment(prop + " = '" + el.value + "'", scope, el);
        }
      });
      addCleanup(el, cl);

    } else if (tag === 'select') {
      var cl = effect(function() {
        el.value = evaluate(prop, scope, el) || '';
      });
      el.addEventListener('change', function() {
        evaluateAssignment(prop + " = '" + el.value + "'", scope, el);
      });
      addCleanup(el, cl);

    } else {
      // text input, textarea, number input, etc.
      var eventName = modifiers.has('lazy') ? 'change' : 'input';

      var cl = effect(function() {
        var value = evaluate(prop, scope, el);
        if (el.value !== String(value != null ? value : '')) {
          el.value = value != null ? value : '';
        }
      });

      var inputHandler = function() {
        var value = el.value;
        if (modifiers.has('number')) value = parseFloat(value) || 0;
        if (modifiers.has('trim')) value = value.trim();
        if (typeof value === 'number') {
          evaluateAssignment(prop + ' = ' + value, scope, el);
        } else {
          evaluateAssignment(prop + " = '" + value.replace(/'/g, "\\'") + "'", scope, el);
        }
      };

      if (modifiers.has('debounce')) {
        inputHandler = debounce(inputHandler, 300);
      }

      el.addEventListener(eventName, inputHandler);
      addCleanup(el, cl);
    }
  }

  // --- 3.16 l-show ---

  function handleShow(el, dir, scope) {
    var originalDisplay = el.style.display === 'none' ? '' : el.style.display;

    var cl = effect(function() {
      var value = evaluate(dir.expression, scope, el);

      if (value) {
        el.style.display = originalDisplay;
        if (el.hasAttribute('l-transition')) {
          runEnterTransition(el, el.getAttribute('l-transition'));
        }
      } else {
        if (el.hasAttribute('l-transition')) {
          runLeaveTransition(el, el.getAttribute('l-transition'), function() {
            el.style.display = 'none';
          });
        } else {
          el.style.display = 'none';
        }
      }
    });

    addCleanup(el, cl);
  }

  // --- 3.17 l-if ---

  function handleIf(el, dir, scope) {
    if (el.tagName !== 'TEMPLATE') {
      console.warn('[Loom] l-if must be used on a <template> element');
      return;
    }

    var anchor = document.createComment('l-if');
    el.parentNode.insertBefore(anchor, el);
    el.remove();

    var insertedNodes = [];

    var cl = effect(function() {
      var value = evaluate(dir.expression, scope, el);

      if (value) {
        if (insertedNodes.length === 0) {
          var fragment = el.content.cloneNode(true);
          var nodes = [].slice.call(fragment.childNodes);

          for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].nodeType === 1) {
              processElement(nodes[i], scope);
              walkChildren(nodes[i], scope);
            }
          }

          anchor.parentNode.insertBefore(fragment, anchor.nextSibling);
          insertedNodes = nodes.filter(function(n) { return n.nodeType === 1; });

          for (var i = 0; i < insertedNodes.length; i++) {
            if (insertedNodes[i].hasAttribute && insertedNodes[i].hasAttribute('l-transition')) {
              runEnterTransition(insertedNodes[i], insertedNodes[i].getAttribute('l-transition'));
            }
          }
        }
      } else {
        for (var i = 0; i < insertedNodes.length; i++) {
          var node = insertedNodes[i];
          if (node.hasAttribute && node.hasAttribute('l-transition')) {
            (function(n) {
              runLeaveTransition(n, n.getAttribute('l-transition'), function() {
                n.remove();
              });
            })(node);
          } else {
            node.remove();
          }
          destroyScope(node);
        }
        insertedNodes = [];
      }
    });

    addCleanup(el, cl);
  }

  // --- 3.18 l-for ---

  function handleFor(el, dir, scope) {
    if (el.tagName !== 'TEMPLATE') {
      console.warn('[Loom] l-for must be used on a <template> element');
      return;
    }

    var match = dir.expression.match(
      /^\s*(?:\(?\s*(\w+)\s*(?:,\s*(\w+))?\s*\)?\s+in\s+)?(.+)\s*$/
    );

    if (!match) {
      console.warn('[Loom] Invalid l-for expression: "' + dir.expression + '"');
      return;
    }

    var itemName = match[1] || 'item';
    var indexName = match[2] || 'index';
    var listExpr = match[3];

    var anchor = document.createComment('l-for');
    el.parentNode.insertBefore(anchor, el);
    el.remove();

    var currentNodes = [];

    var cl = effect(function() {
      var list = evaluate(listExpr, scope, el);
      var items = Array.isArray(list) ? list :
                  typeof list === 'number' ? Array.from({ length: list }, function(_, i) { return i + 1; }) :
                  [];

      // Clean up previous render
      for (var i = 0; i < currentNodes.length; i++) {
        destroyScope(currentNodes[i]);
        currentNodes[i].remove();
      }
      currentNodes = [];

      var fragment = document.createDocumentFragment();

      for (var i = 0; i < items.length; i++) {
        var clone = el.content.cloneNode(true);
        var nodes = [].slice.call(clone.childNodes).filter(function(n) { return n.nodeType === 1; });

        for (var j = 0; j < nodes.length; j++) {
          var childOwn = Object.create(null);
          childOwn[itemName] = items[i];
          childOwn[indexName] = i;

          // Delegating child scope: reads/writes of parent properties go
          // through the parent scope so that mutations trigger reactivity.
          var childScope = (function(own, parentScope) {
            return new Proxy(own, {
              get: function(target, key) {
                if (key === '__isReactive') return true;
                if (key === '__target') return target;
                if (key === '__deps') return parentScope.__deps;
                return (key in target) ? target[key] : parentScope[key];
              },
              set: function(target, key, value) {
                if (key in target) {
                  target[key] = value;
                } else {
                  parentScope[key] = value;
                }
                return true;
              },
              has: function(target, key) {
                return (key in target) || (key in parentScope);
              }
            });
          })(childOwn, scope);
          nodes[j].__loomScope = childScope;
          nodes[j].__loomCleanups = [];

          processElement(nodes[j], childScope);
          walkChildren(nodes[j], childScope);
          currentNodes.push(nodes[j]);
        }

        fragment.appendChild(clone);
      }

      anchor.parentNode.insertBefore(fragment, anchor.nextSibling);
    });

    addCleanup(el, cl);
  }

  // --- 3.19 l-teleport ---

  function handleTeleport(el, dir, scope) {
    var cl = effect(function() {
      var target = document.querySelector(dir.expression);
      if (target && el.parentNode !== target) {
        target.appendChild(el);
      }
    });
    addCleanup(el, cl);
  }

  // ═══════════════════════════════════════════════════════
  // Section 4-5: Loom Bridge ($state, $variant, $ui)
  // ═══════════════════════════════════════════════════════

  function closestUI(el) {
    if (!el) return null;
    if (el.hasAttribute && el.hasAttribute('data-ui')) return el;
    return el.closest ? el.closest('[data-ui]') : null;
  }

  function getControllerApi(uiEl) {
    if (!uiEl) return null;
    var keys = Object.keys(uiEl);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].startsWith('_loom')) {
        return uiEl[keys[i]];
      }
    }
    return null;
  }

  function setupStateBridge(root, scope) {
    var uiEl = root.hasAttribute('data-ui') ? root : (root.closest ? root.closest('[data-ui]') : null);
    if (!uiEl) return;

    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var attr = mutations[i].attributeName;
        if (attr === 'data-state' || attr === 'data-variant') {
          triggerStateDeps(scope);
        }
      }
    });

    observer.observe(uiEl, {
      attributes: true,
      attributeFilter: ['data-state', 'data-variant']
    });

    addCleanup(root, function() { observer.disconnect(); });
  }

  function triggerStateDeps(scope) {
    var deps = scope.__deps;
    if (!deps) return;
    if (deps['$state']) {
      for (var eff of deps['$state']) {
        pendingEffects.add(eff);
      }
      scheduleFlush();
    }
    if (deps['$variant']) {
      for (var eff of deps['$variant']) {
        pendingEffects.add(eff);
      }
      scheduleFlush();
    }
  }

  // ═══════════════════════════════════════════════════════
  // Section 6: Core Utilities
  // ═══════════════════════════════════════════════════════

  // --- From dom.js ---
  var $ = function(selector, scope) { return (scope || document).querySelector(selector); };
  var $$ = function(selector, scope) { return [].slice.call((scope || document).querySelectorAll(selector)); };

  function create(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      var keys = Object.keys(attrs);
      for (var i = 0; i < keys.length; i++) {
        el.setAttribute(keys[i], attrs[keys[i]]);
      }
    }
    for (var j = 2; j < arguments.length; j++) {
      var child = arguments[j];
      el.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return el;
  }

  // --- From events.js ---
  function delegate(root, event, selector, handler) {
    function listener(e) {
      var target = e.target.closest(selector);
      if (target && root.contains(target)) handler(e, target);
    }
    root.addEventListener(event, listener);
    return function() { root.removeEventListener(event, listener); };
  }

  function once(el, event, handler) {
    function listener(e) { cleanupOnce(); handler(e); }
    function cleanupOnce() { el.removeEventListener(event, listener); }
    el.addEventListener(event, listener);
    return cleanupOnce;
  }

  function onOutsideClick(el, handler) {
    function listener(e) { if (!el.contains(e.target)) handler(e); }
    document.addEventListener('pointerdown', listener);
    return function() { document.removeEventListener('pointerdown', listener); };
  }

  // --- From focus.js ---
  var FOCUSABLE = [
    'a[href]:not([tabindex="-1"])',
    'button:not([disabled]):not([tabindex="-1"])',
    'input:not([disabled]):not([tabindex="-1"])',
    'select:not([disabled]):not([tabindex="-1"])',
    'textarea:not([disabled]):not([tabindex="-1"])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  function getFocusableElements(container) {
    return [].slice.call(container.querySelectorAll(FOCUSABLE)).filter(function(el) {
      return !el.closest('[hidden]') && el.offsetParent !== null;
    });
  }

  function focusFirst(container) {
    var els = getFocusableElements(container);
    if (els.length > 0) { els[0].focus(); return true; }
    return false;
  }

  function trapFocus(container) {
    function onKeyDown(e) {
      if (e.key !== 'Tab') return;
      var focusable = getFocusableElements(container);
      if (focusable.length === 0) return;
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    container.addEventListener('keydown', onKeyDown);
    return function() { container.removeEventListener('keydown', onKeyDown); };
  }

  // --- From motion.js (prefersReducedMotion already defined in Section 3.14) ---
  function waitForTransition(el) {
    if (prefersReducedMotion()) return Promise.resolve();
    var style = getComputedStyle(el);
    var hasDuration = parseFloat(style.transitionDuration) > 0 ||
      (style.animationName !== 'none' && parseFloat(style.animationDuration) > 0);
    if (!hasDuration) return Promise.resolve();
    return new Promise(function(resolve) {
      function done(e) {
        if (e.target !== el) return;
        el.removeEventListener('transitionend', done);
        el.removeEventListener('animationend', done);
        resolve();
      }
      el.addEventListener('transitionend', done);
      el.addEventListener('animationend', done);
    });
  }

  // --- From utils.js (debounce/throttle already defined in Section 3.9) ---
  var uidCounter = 0;
  function uid(prefix) { return (prefix || 'loom') + '-' + (++uidCounter); }
  function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }

  // ═══════════════════════════════════════════════════════
  // Section 7: Recipe Controllers
  // ═══════════════════════════════════════════════════════

  var controllerRegistry = {};

  // --- dialog ---
  function createDialog(root) {
    if (root._loomDialog) return root._loomDialog;

    var trigger = root.querySelector("[data-part='trigger']");
    var overlay = root.querySelector("[data-part='overlay']");
    var panel = root.querySelector("[data-part='panel']");
    var closeButtons = root.querySelectorAll("[data-part='close']");

    var focusCleanup = null;
    var previouslyFocused = null;

    function open() {
      previouslyFocused = document.activeElement;
      root.dataset.state = 'open';
      overlay.hidden = false;
      panel.hidden = false;
      focusCleanup = trapFocus(panel);
      if (panel.focus) panel.focus();
    }

    function close() {
      root.dataset.state = 'closing';

      var onEnd = function() {
        root.dataset.state = 'closed';
        overlay.hidden = true;
        panel.hidden = true;
        if (focusCleanup) focusCleanup();
        focusCleanup = null;
        if (previouslyFocused) previouslyFocused.focus();
        panel.removeEventListener('animationend', onEnd);
        panel.removeEventListener('transitionend', onEnd);
      };

      var hasAnimation = false;
      try {
        var style = getComputedStyle(panel);
        var animName = style.animationName || 'none';
        var animDur = parseFloat(style.animationDuration) || 0;
        var transDur = parseFloat(style.transitionDuration) || 0;
        hasAnimation = (animName !== 'none' && animDur > 0) || transDur > 0;
      } catch (e) {}

      if (hasAnimation) {
        panel.addEventListener('animationend', onEnd, { once: true });
        panel.addEventListener('transitionend', onEnd, { once: true });
      } else {
        onEnd();
      }
    }

    function toggle() {
      root.dataset.state === 'open' ? close() : open();
    }

    function onTriggerClick() { open(); }
    function onOverlayClick() { close(); }
    function onCloseClick() { close(); }
    function onKeyDown(e) {
      if (e.key === 'Escape' && root.dataset.state === 'open') {
        e.stopPropagation();
        close();
      }
    }

    if (trigger) trigger.addEventListener('click', onTriggerClick);
    if (overlay) overlay.addEventListener('click', onOverlayClick);
    closeButtons.forEach(function(btn) { btn.addEventListener('click', onCloseClick); });
    root.addEventListener('keydown', onKeyDown);

    var externalTriggers = root.id ? document.querySelectorAll('[data-open="' + root.id + '"]') : [];
    if (externalTriggers.length) {
      externalTriggers.forEach(function(el) { el.addEventListener('click', onTriggerClick); });
    }

    function destroy() {
      if (trigger) trigger.removeEventListener('click', onTriggerClick);
      if (overlay) overlay.removeEventListener('click', onOverlayClick);
      closeButtons.forEach(function(btn) { btn.removeEventListener('click', onCloseClick); });
      root.removeEventListener('keydown', onKeyDown);
      if (externalTriggers.length) {
        externalTriggers.forEach(function(el) { el.removeEventListener('click', onTriggerClick); });
      }
      if (focusCleanup) focusCleanup();
      delete root._loomDialog;
    }

    var api = { open: open, close: close, toggle: toggle, destroy: destroy };
    root._loomDialog = api;
    return api;
  }

  // --- drawer ---
  function createDrawer(root) {
    if (root._loomDrawer) return root._loomDrawer;

    var trigger = root.querySelector("[data-part='trigger']");
    var overlay = root.querySelector("[data-part='overlay']");
    var panel = root.querySelector("[data-part='panel']");
    var closeButtons = root.querySelectorAll("[data-part='close']");

    var focusCleanup = null;
    var previouslyFocused = null;

    function open() {
      previouslyFocused = document.activeElement;
      root.dataset.state = 'open';
      overlay.hidden = false;
      panel.hidden = false;
      focusCleanup = trapFocus(panel);
      if (panel.focus) panel.focus();
    }

    function close() {
      root.dataset.state = 'closing';

      var onEnd = function() {
        root.dataset.state = 'closed';
        overlay.hidden = true;
        panel.hidden = true;
        if (focusCleanup) focusCleanup();
        focusCleanup = null;
        if (previouslyFocused) previouslyFocused.focus();
        panel.removeEventListener('transitionend', onTransEnd);
      };

      var hasTransition = false;
      try {
        var style = getComputedStyle(panel);
        var transDur = parseFloat(style.transitionDuration) || 0;
        hasTransition = transDur > 0;
      } catch (e) {}

      var onTransEnd = function(e) {
        if (e.propertyName === 'transform') onEnd();
      };

      if (hasTransition) {
        panel.addEventListener('transitionend', onTransEnd, { once: true });
      } else {
        onEnd();
      }
    }

    function toggle() {
      root.dataset.state === 'open' ? close() : open();
    }

    function onTriggerClick() { open(); }
    function onOverlayClick() { close(); }
    function onCloseClick() { close(); }
    function onKeyDown(e) {
      if (e.key === 'Escape' && root.dataset.state === 'open') {
        e.stopPropagation();
        close();
      }
    }

    if (trigger) trigger.addEventListener('click', onTriggerClick);
    if (overlay) overlay.addEventListener('click', onOverlayClick);
    closeButtons.forEach(function(btn) { btn.addEventListener('click', onCloseClick); });
    root.addEventListener('keydown', onKeyDown);

    var externalTriggers = root.id ? document.querySelectorAll('[data-open="' + root.id + '"]') : [];
    if (externalTriggers.length) {
      externalTriggers.forEach(function(el) { el.addEventListener('click', onTriggerClick); });
    }

    function destroy() {
      if (trigger) trigger.removeEventListener('click', onTriggerClick);
      if (overlay) overlay.removeEventListener('click', onOverlayClick);
      closeButtons.forEach(function(btn) { btn.removeEventListener('click', onCloseClick); });
      root.removeEventListener('keydown', onKeyDown);
      if (externalTriggers.length) {
        externalTriggers.forEach(function(el) { el.removeEventListener('click', onTriggerClick); });
      }
      if (focusCleanup) focusCleanup();
      delete root._loomDrawer;
    }

    var api = { open: open, close: close, toggle: toggle, destroy: destroy };
    root._loomDrawer = api;
    return api;
  }

  // --- tabs ---
  function createTabs(root) {
    if (root._loomTabs) return root._loomTabs;

    var list = root.querySelector("[data-part='list']");
    var triggers = function() { return [].slice.call(root.querySelectorAll("[data-part='trigger']")); };
    var panels = function() { return [].slice.call(root.querySelectorAll("[data-part='panel']")); };

    function activate(index) {
      var allTriggers = triggers();
      var allPanels = panels();
      if (index < 0 || index >= allTriggers.length) return;

      allTriggers.forEach(function(trigger, i) {
        trigger.setAttribute('aria-selected', 'false');
        trigger.setAttribute('tabindex', '-1');
        if (allPanels[i]) allPanels[i].hidden = true;
      });

      allTriggers[index].setAttribute('aria-selected', 'true');
      allTriggers[index].removeAttribute('tabindex');
      if (allPanels[index]) allPanels[index].hidden = false;
    }

    function getActiveIndex() {
      return triggers().findIndex(function(t) {
        return t.getAttribute('aria-selected') === 'true';
      });
    }

    function onTriggerClick(e) {
      var trigger = e.target.closest("[data-part='trigger']");
      if (!trigger) return;
      var index = triggers().indexOf(trigger);
      if (index >= 0) {
        activate(index);
        trigger.focus();
      }
    }

    function onKeyDown(e) {
      var allTriggers = triggers();
      var current = getActiveIndex();
      var next = -1;

      switch (e.key) {
        case 'ArrowRight': next = (current + 1) % allTriggers.length; break;
        case 'ArrowLeft': next = (current - 1 + allTriggers.length) % allTriggers.length; break;
        case 'Home': next = 0; break;
        case 'End': next = allTriggers.length - 1; break;
        default: return;
      }

      e.preventDefault();
      activate(next);
      allTriggers[next].focus();
    }

    if (list) list.addEventListener('click', onTriggerClick);
    if (list) list.addEventListener('keydown', onKeyDown);

    function destroy() {
      if (list) list.removeEventListener('click', onTriggerClick);
      if (list) list.removeEventListener('keydown', onKeyDown);
      delete root._loomTabs;
    }

    var api = { activate: activate, getActiveIndex: getActiveIndex, destroy: destroy };
    root._loomTabs = api;
    return api;
  }

  // --- dropdown ---
  function createDropdown(root) {
    if (root._loomDropdown) return root._loomDropdown;

    var trigger = root.querySelector("[data-part='trigger']");
    var menu = root.querySelector("[data-part='menu']");
    var items = function() {
      return [].slice.call(root.querySelectorAll("[data-part='item']:not(:disabled)"));
    };

    var outsideClickCleanup = null;

    function open() {
      root.dataset.state = 'open';
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      var allItems = items();
      if (allItems.length > 0) allItems[0].focus();
      outsideClickCleanup = onOutsideClick(root, close);
    }

    function close() {
      root.dataset.state = 'closed';
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (outsideClickCleanup) { outsideClickCleanup(); outsideClickCleanup = null; }
      trigger.focus();
    }

    function toggle() {
      root.dataset.state === 'open' ? close() : open();
    }

    function focusItem(index) {
      var allItems = items();
      if (index < 0 || index >= allItems.length) return;
      allItems[index].focus();
    }

    function getFocusedIndex() {
      return items().indexOf(document.activeElement);
    }

    function onTriggerClick() { toggle(); }

    function onTriggerKeyDown(e) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        if (root.dataset.state !== 'open') { e.preventDefault(); open(); }
      }
    }

    function onMenuKeyDown(e) {
      var allItems = items();
      var current = getFocusedIndex();
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); focusItem((current + 1) % allItems.length); break;
        case 'ArrowUp': e.preventDefault(); focusItem((current - 1 + allItems.length) % allItems.length); break;
        case 'Home': e.preventDefault(); focusItem(0); break;
        case 'End': e.preventDefault(); focusItem(allItems.length - 1); break;
        case 'Escape': e.preventDefault(); close(); break;
        case 'Tab': close(); break;
      }
    }

    if (trigger) trigger.addEventListener('click', onTriggerClick);
    if (trigger) trigger.addEventListener('keydown', onTriggerKeyDown);
    if (menu) menu.addEventListener('keydown', onMenuKeyDown);
    if (menu) menu.addEventListener('click', function(e) {
      var item = e.target.closest("[data-part='item']");
      if (item && !item.disabled) close();
    });

    function destroy() {
      if (trigger) trigger.removeEventListener('click', onTriggerClick);
      if (trigger) trigger.removeEventListener('keydown', onTriggerKeyDown);
      if (menu) menu.removeEventListener('keydown', onMenuKeyDown);
      if (outsideClickCleanup) outsideClickCleanup();
      delete root._loomDropdown;
    }

    var api = { open: open, close: close, toggle: toggle, destroy: destroy };
    root._loomDropdown = api;
    return api;
  }

  // --- accordion ---
  function createAccordion(root) {
    if (root._loomAccordion) return root._loomAccordion;

    var getItems = function() { return [].slice.call(root.querySelectorAll("[data-part='item']")); };
    var isSingle = function() { return root.dataset.variant === 'single'; };

    function expandItem(item) {
      item.dataset.state = 'expanded';
      var trig = item.querySelector("[data-part='trigger']");
      var content = item.querySelector("[data-part='content']");
      if (trig) trig.setAttribute('aria-expanded', 'true');
      if (content) content.hidden = false;
    }

    function collapseItem(item) {
      item.dataset.state = 'collapsed';
      var trig = item.querySelector("[data-part='trigger']");
      var content = item.querySelector("[data-part='content']");
      if (trig) trig.setAttribute('aria-expanded', 'false');
      if (content) content.hidden = true;
    }

    function expand(index) {
      var allItems = getItems();
      if (index < 0 || index >= allItems.length) return;
      if (isSingle()) {
        allItems.forEach(function(item, i) { if (i !== index) collapseItem(item); });
      }
      expandItem(allItems[index]);
    }

    function collapse(index) {
      var allItems = getItems();
      if (index < 0 || index >= allItems.length) return;
      collapseItem(allItems[index]);
    }

    function toggleAccordion(index) {
      var allItems = getItems();
      if (index < 0 || index >= allItems.length) return;
      allItems[index].dataset.state === 'expanded' ? collapse(index) : expand(index);
    }

    function expandAll() { getItems().forEach(function(item) { expandItem(item); }); }
    function collapseAll() { getItems().forEach(function(item) { collapseItem(item); }); }

    function onTriggerClick(e) {
      var trig = e.target.closest("[data-part='trigger']");
      if (!trig) return;
      var item = trig.closest("[data-part='item']");
      if (!item) return;
      var index = getItems().indexOf(item);
      if (index >= 0) toggleAccordion(index);
    }

    function onKeyDown(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        var trig = e.target.closest("[data-part='trigger']");
        if (trig) {
          e.preventDefault();
          var item = trig.closest("[data-part='item']");
          if (!item) return;
          var index = getItems().indexOf(item);
          if (index >= 0) toggleAccordion(index);
        }
      }
    }

    root.addEventListener('click', onTriggerClick);
    root.addEventListener('keydown', onKeyDown);

    function destroy() {
      root.removeEventListener('click', onTriggerClick);
      root.removeEventListener('keydown', onKeyDown);
      delete root._loomAccordion;
    }

    var api = { toggle: toggleAccordion, expand: expand, collapse: collapse, expandAll: expandAll, collapseAll: collapseAll, destroy: destroy };
    root._loomAccordion = api;
    return api;
  }

  // --- tooltip ---
  function createTooltip(root) {
    if (root._loomTooltip) return root._loomTooltip;

    var trigger = root.querySelector("[data-part='trigger']");
    var content = root.querySelector("[data-part='content']");
    var showTimer = null;
    var hideTimer = null;

    function show() {
      clearTimeout(hideTimer); hideTimer = null;
      root.dataset.state = 'visible';
      content.hidden = false;
    }

    function hide() {
      clearTimeout(showTimer); showTimer = null;
      root.dataset.state = 'hidden';
      content.hidden = true;
    }

    function scheduleShow() { clearTimeout(hideTimer); hideTimer = null; showTimer = setTimeout(show, 200); }
    function scheduleHide() { clearTimeout(showTimer); showTimer = null; hideTimer = setTimeout(hide, 100); }

    function onMouseEnter() { scheduleShow(); }
    function onMouseLeave() { scheduleHide(); }
    function onFocusIn() { scheduleShow(); }
    function onFocusOut() { scheduleHide(); }
    function onKeyDown(e) {
      if (e.key === 'Escape' && root.dataset.state === 'visible') { e.stopPropagation(); hide(); }
    }

    if (trigger) trigger.addEventListener('mouseenter', onMouseEnter);
    if (trigger) trigger.addEventListener('mouseleave', onMouseLeave);
    if (trigger) trigger.addEventListener('focusin', onFocusIn);
    if (trigger) trigger.addEventListener('focusout', onFocusOut);
    root.addEventListener('keydown', onKeyDown);

    function destroy() {
      clearTimeout(showTimer); clearTimeout(hideTimer);
      if (trigger) trigger.removeEventListener('mouseenter', onMouseEnter);
      if (trigger) trigger.removeEventListener('mouseleave', onMouseLeave);
      if (trigger) trigger.removeEventListener('focusin', onFocusIn);
      if (trigger) trigger.removeEventListener('focusout', onFocusOut);
      root.removeEventListener('keydown', onKeyDown);
      delete root._loomTooltip;
    }

    var api = { show: show, hide: hide, destroy: destroy };
    root._loomTooltip = api;
    return api;
  }

  // --- toast ---
  function createToastContainer(root) {
    if (root._loomToast) return root._loomToast;

    var toasts = new Map();

    function add(options) {
      options = options || {};
      var message = options.message || '';
      var tone = options.tone || 'default';
      var icon = options.icon || '';
      var actionLabel = options.actionLabel || '';
      var onAction = options.onAction || null;
      var duration = options.duration !== undefined ? options.duration : 5000;

      var id = uid('toast');
      var el = document.createElement('div');
      el.dataset.part = 'toast';
      el.dataset.variant = tone;
      el.dataset.state = 'entering';
      el.dataset.toastId = id;
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');

      var html = '';
      if (icon) html += '<span data-part="icon" aria-hidden="true">' + icon + '</span>';
      html += '<span data-part="message">' + message + '</span>';
      if (actionLabel) html += '<button data-part="action">' + actionLabel + '</button>';
      html += '<button data-part="close" aria-label="Dismiss notification">&#x2715;</button>';
      el.innerHTML = html;
      root.appendChild(el);

      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          if (el.dataset.state === 'entering') el.dataset.state = 'visible';
        });
      });

      var closeBtn = el.querySelector("[data-part='close']");
      var onCloseClick = function() { dismiss(id); };
      if (closeBtn) closeBtn.addEventListener('click', onCloseClick);

      var actionBtn = el.querySelector("[data-part='action']");
      var onActionClick = function() { if (onAction) onAction(); dismiss(id); };
      if (actionBtn) actionBtn.addEventListener('click', onActionClick);

      var timer = null;
      if (duration > 0) timer = setTimeout(function() { dismiss(id); }, duration);

      toasts.set(id, { el: el, timer: timer, closeBtn: closeBtn, onCloseClick: onCloseClick, actionBtn: actionBtn, onActionClick: onActionClick });
      return id;
    }

    function dismiss(id) {
      var entry = toasts.get(id);
      if (!entry) return;
      if (entry.timer) clearTimeout(entry.timer);
      entry.el.dataset.state = 'exiting';

      var onEnd = function() {
        if (entry.closeBtn) entry.closeBtn.removeEventListener('click', entry.onCloseClick);
        if (entry.actionBtn) entry.actionBtn.removeEventListener('click', entry.onActionClick);
        entry.el.removeEventListener('transitionend', onEnd);
        entry.el.remove();
        toasts.delete(id);
      };

      var hasTransition = false;
      try {
        var style = getComputedStyle(entry.el);
        hasTransition = (parseFloat(style.transitionDuration) || 0) > 0;
      } catch (e) {}

      if (hasTransition) {
        entry.el.addEventListener('transitionend', onEnd, { once: true });
      } else {
        onEnd();
      }
    }

    function dismissAll() {
      var ids = []; toasts.forEach(function(_, id) { ids.push(id); });
      ids.forEach(function(id) { dismiss(id); });
    }

    function destroy() {
      toasts.forEach(function(entry) {
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.closeBtn) entry.closeBtn.removeEventListener('click', entry.onCloseClick);
        if (entry.actionBtn) entry.actionBtn.removeEventListener('click', entry.onActionClick);
        entry.el.remove();
      });
      toasts.clear();
      delete root._loomToast;
    }

    var api = { add: add, dismiss: dismiss, dismissAll: dismissAll, destroy: destroy };
    root._loomToast = api;
    return api;
  }

  // --- combobox ---
  function createCombobox(root) {
    if (root._loomCombobox) return root._loomCombobox;

    var input = root.querySelector("[data-part='input']");
    var listbox = root.querySelector("[data-part='listbox']");
    var emptyEl = root.querySelector("[data-part='empty']");
    var getOptions = function() { return [].slice.call(root.querySelectorAll("[data-part='option']")); };

    var highlightedIndex = -1;
    var outsideClickCleanup = null;
    var selectedValue = '';

    function open() {
      root.dataset.state = 'open';
      listbox.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      outsideClickCleanup = onOutsideClick(root, close);
    }

    function close() {
      root.dataset.state = 'closed';
      listbox.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      clearHighlight();
      if (outsideClickCleanup) { outsideClickCleanup(); outsideClickCleanup = null; }
    }

    function clearHighlight() {
      getOptions().forEach(function(opt) {
        opt.removeAttribute('data-highlighted');
        opt.setAttribute('aria-selected', 'false');
      });
      highlightedIndex = -1;
    }

    function visibleOptions() {
      return getOptions().filter(function(opt) { return !opt.hasAttribute('data-hidden'); });
    }

    function highlightOption(index) {
      var visible = visibleOptions();
      if (visible.length === 0) return;
      if (index < 0) index = visible.length - 1;
      if (index >= visible.length) index = 0;
      getOptions().forEach(function(opt) {
        opt.removeAttribute('data-highlighted');
        opt.setAttribute('aria-selected', 'false');
      });
      visible[index].setAttribute('data-highlighted', '');
      visible[index].setAttribute('aria-selected', 'true');
      visible[index].scrollIntoView({ block: 'nearest' });
      highlightedIndex = index;
    }

    function filter(query) {
      var allOptions = getOptions();
      var lowerQuery = query.toLowerCase();
      var visibleCount = 0;
      allOptions.forEach(function(opt) {
        if (opt.textContent.toLowerCase().includes(lowerQuery)) {
          opt.removeAttribute('data-hidden'); visibleCount++;
        } else {
          opt.setAttribute('data-hidden', '');
        }
      });
      if (emptyEl) emptyEl.hidden = visibleCount > 0;
      clearHighlight();
      return visibleCount;
    }

    function selectOption(index) {
      var visible = visibleOptions();
      if (index < 0 || index >= visible.length) return;
      selectedValue = visible[index].textContent.trim();
      input.value = selectedValue;
      getOptions().forEach(function(o) { o.setAttribute('aria-selected', 'false'); });
      visible[index].setAttribute('aria-selected', 'true');
      close();
    }

    function getValue() { return selectedValue; }
    function setValue(val) { selectedValue = val; input.value = val; }

    function onInput() {
      if (root.dataset.state !== 'open') open();
      filter(input.value);
    }
    function onInputFocus() { if (root.dataset.state !== 'open') open(); }
    function onInputKeyDown(e) {
      var visible = visibleOptions();
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); if (root.dataset.state !== 'open') open(); highlightOption(highlightedIndex + 1); break;
        case 'ArrowUp': e.preventDefault(); if (root.dataset.state !== 'open') open(); highlightOption(highlightedIndex - 1); break;
        case 'Enter': e.preventDefault(); if (highlightedIndex >= 0 && highlightedIndex < visible.length) selectOption(highlightedIndex); break;
        case 'Escape': e.preventDefault(); close(); break;
        case 'Home': if (root.dataset.state === 'open' && visible.length > 0) { e.preventDefault(); highlightOption(0); } break;
        case 'End': if (root.dataset.state === 'open' && visible.length > 0) { e.preventDefault(); highlightOption(visible.length - 1); } break;
      }
    }
    function onListboxClick(e) {
      var opt = e.target.closest("[data-part='option']");
      if (!opt) return;
      var index = visibleOptions().indexOf(opt);
      if (index >= 0) selectOption(index);
    }

    if (input) input.addEventListener('input', onInput);
    if (input) input.addEventListener('focus', onInputFocus);
    if (input) input.addEventListener('keydown', onInputKeyDown);
    if (listbox) listbox.addEventListener('click', onListboxClick);

    function destroy() {
      if (input) input.removeEventListener('input', onInput);
      if (input) input.removeEventListener('focus', onInputFocus);
      if (input) input.removeEventListener('keydown', onInputKeyDown);
      if (listbox) listbox.removeEventListener('click', onListboxClick);
      if (outsideClickCleanup) outsideClickCleanup();
      delete root._loomCombobox;
    }

    var api = { open: open, close: close, filter: filter, selectOption: selectOption, getValue: getValue, setValue: setValue, destroy: destroy };
    root._loomCombobox = api;
    return api;
  }

  // --- command-palette ---
  function createCommandPalette(root) {
    if (root._loomCommandPalette) return root._loomCommandPalette;

    var overlay = root.querySelector("[data-part='overlay']");
    var panel = root.querySelector("[data-part='panel']");
    var searchInput = root.querySelector("[data-part='search']");
    var list = root.querySelector("[data-part='list']");
    var emptyEl = root.querySelector("[data-part='empty']");
    var getItems = function() { return [].slice.call(root.querySelectorAll("[data-part='item']")); };
    var getGroups = function() { return [].slice.call(root.querySelectorAll("[data-part='group']")); };

    var highlightedIndex = -1;
    var focusCleanup = null;
    var previouslyFocused = null;
    var registeredCommands = [];

    function visibleItems() {
      return getItems().filter(function(item) { return !item.hasAttribute('data-hidden'); });
    }

    function open() {
      previouslyFocused = document.activeElement;
      root.dataset.state = 'open';
      overlay.hidden = false;
      panel.hidden = false;
      searchInput.value = '';
      filter('');
      clearHighlight();
      focusCleanup = trapFocus(panel);
      searchInput.focus();
    }

    function close() {
      root.dataset.state = 'closed';
      overlay.hidden = true;
      panel.hidden = true;
      if (focusCleanup) { focusCleanup(); focusCleanup = null; }
      if (previouslyFocused) previouslyFocused.focus();
    }

    function clearHighlight() {
      getItems().forEach(function(item) {
        item.removeAttribute('data-highlighted');
        item.setAttribute('aria-selected', 'false');
      });
      highlightedIndex = -1;
    }

    function highlightItem(index) {
      var visible = visibleItems();
      if (visible.length === 0) return;
      if (index < 0) index = visible.length - 1;
      if (index >= visible.length) index = 0;
      getItems().forEach(function(item) {
        item.removeAttribute('data-highlighted');
        item.setAttribute('aria-selected', 'false');
      });
      visible[index].setAttribute('data-highlighted', '');
      visible[index].setAttribute('aria-selected', 'true');
      visible[index].scrollIntoView({ block: 'nearest' });
      highlightedIndex = index;
    }

    function filter(query) {
      var allItems = getItems();
      var allGroups = getGroups();
      var lowerQuery = query.toLowerCase();
      var totalVisible = 0;
      var groupVisibility = new Map();
      allGroups.forEach(function(g) { groupVisibility.set(g, 0); });

      allItems.forEach(function(item) {
        var label = item.querySelector("[data-part='item-label']");
        var text = (label || item).textContent.toLowerCase();
        if (text.includes(lowerQuery)) {
          item.removeAttribute('data-hidden'); totalVisible++;
          var parentGroup = item.closest("[data-part='group']");
          if (parentGroup && groupVisibility.has(parentGroup)) {
            groupVisibility.set(parentGroup, groupVisibility.get(parentGroup) + 1);
          }
        } else {
          item.setAttribute('data-hidden', '');
        }
      });

      allGroups.forEach(function(group) {
        if (groupVisibility.get(group) === 0) group.setAttribute('data-hidden', '');
        else group.removeAttribute('data-hidden');
      });
      if (emptyEl) emptyEl.hidden = totalVisible > 0;
      clearHighlight();
      return totalVisible;
    }

    function selectItem(index) {
      var visible = visibleItems();
      if (index < 0 || index >= visible.length) return;
      var item = visible[index];
      root.dispatchEvent(new CustomEvent('command-select', {
        bubbles: true,
        detail: { item: item, label: (item.querySelector("[data-part='item-label']") || item).textContent }
      }));
      var label = (item.querySelector("[data-part='item-label']") || item).textContent.trim();
      var cmd = registeredCommands.find(function(c) { return c.label === label; });
      if (cmd && cmd.action) cmd.action();
      close();
    }

    function registerCommand(cmd) { registeredCommands.push(cmd); }

    function onSearchInput() { filter(searchInput.value); }
    function onSearchKeyDown(e) {
      var visible = visibleItems();
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); highlightItem(highlightedIndex + 1); break;
        case 'ArrowUp': e.preventDefault(); highlightItem(highlightedIndex - 1); break;
        case 'Enter': e.preventDefault(); if (highlightedIndex >= 0 && highlightedIndex < visible.length) selectItem(highlightedIndex); break;
        case 'Escape': e.preventDefault(); close(); break;
        case 'Home': if (visible.length > 0) { e.preventDefault(); highlightItem(0); } break;
        case 'End': if (visible.length > 0) { e.preventDefault(); highlightItem(visible.length - 1); } break;
      }
    }
    function onOverlayClick() { close(); }
    function onItemClick(e) {
      var item = e.target.closest("[data-part='item']");
      if (!item) return;
      var index = visibleItems().indexOf(item);
      if (index >= 0) selectItem(index);
    }
    function onGlobalKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        root.dataset.state === 'open' ? close() : open();
      }
    }

    if (searchInput) searchInput.addEventListener('input', onSearchInput);
    if (searchInput) searchInput.addEventListener('keydown', onSearchKeyDown);
    if (overlay) overlay.addEventListener('click', onOverlayClick);
    if (list) list.addEventListener('click', onItemClick);
    document.addEventListener('keydown', onGlobalKeyDown);

    function destroy() {
      if (searchInput) searchInput.removeEventListener('input', onSearchInput);
      if (searchInput) searchInput.removeEventListener('keydown', onSearchKeyDown);
      if (overlay) overlay.removeEventListener('click', onOverlayClick);
      if (list) list.removeEventListener('click', onItemClick);
      document.removeEventListener('keydown', onGlobalKeyDown);
      if (focusCleanup) focusCleanup();
      delete root._loomCommandPalette;
    }

    var api = { open: open, close: close, filter: filter, selectItem: selectItem, registerCommand: registerCommand, destroy: destroy };
    root._loomCommandPalette = api;
    return api;
  }

  // --- table ---
  function createTable(root) {
    if (root._loomTable) return root._loomTable;

    var thead = root.querySelector("[data-part='thead']");
    var tbody = root.querySelector("[data-part='tbody']");
    var headerCheckbox = thead ? thead.querySelector("[data-part='checkbox']") : null;
    var sortableHeaders = function() { return [].slice.call(root.querySelectorAll("[data-part='th'][data-sortable]")); };
    var bodyRows = function() { return [].slice.call(tbody ? tbody.querySelectorAll("[data-part='tr']") : []); };

    var lastSelectedIndex = -1;

    function sort(columnIndex, direction) {
      var rows = bodyRows();
      if (rows.length === 0) return;
      var allHeaders = [].slice.call(thead ? thead.querySelectorAll("[data-part='th']") : []);
      sortableHeaders().forEach(function(th) { th.setAttribute('aria-sort', 'none'); });
      if (allHeaders[columnIndex] && allHeaders[columnIndex].hasAttribute('data-sortable')) {
        allHeaders[columnIndex].setAttribute('aria-sort', direction);
      }
      var sortedRows = rows.sort(function(a, b) {
        var aCells = [].slice.call(a.querySelectorAll("[data-part='td']"));
        var bCells = [].slice.call(b.querySelectorAll("[data-part='td']"));
        var aVal = aCells[columnIndex] ? aCells[columnIndex].textContent.trim() : '';
        var bVal = bCells[columnIndex] ? bCells[columnIndex].textContent.trim() : '';
        var aNum = parseFloat(aVal.replace(/[^0-9.-]/g, ''));
        var bNum = parseFloat(bVal.replace(/[^0-9.-]/g, ''));
        var result;
        if (!isNaN(aNum) && !isNaN(bNum)) result = aNum - bNum;
        else result = aVal.localeCompare(bVal);
        return direction === 'ascending' ? result : -result;
      });
      sortedRows.forEach(function(row) { tbody.appendChild(row); });
    }

    function updateHeaderCheckbox() {
      if (!headerCheckbox) return;
      var rows = bodyRows();
      var selected = rows.filter(function(r) { return r.hasAttribute('data-selected'); });
      if (selected.length === 0) { headerCheckbox.checked = false; headerCheckbox.indeterminate = false; }
      else if (selected.length === rows.length) { headerCheckbox.checked = true; headerCheckbox.indeterminate = false; }
      else { headerCheckbox.checked = false; headerCheckbox.indeterminate = true; }
    }

    function selectRow(index) {
      var rows = bodyRows();
      if (index < 0 || index >= rows.length) return;
      var row = rows[index];
      var isSelected = row.hasAttribute('data-selected');
      if (isSelected) {
        row.removeAttribute('data-selected');
        var cb = row.querySelector("[data-part='checkbox']"); if (cb) cb.checked = false;
      } else {
        row.setAttribute('data-selected', '');
        var cb = row.querySelector("[data-part='checkbox']"); if (cb) cb.checked = true;
      }
      lastSelectedIndex = index;
      updateHeaderCheckbox();
    }

    function selectAll() {
      bodyRows().forEach(function(row) {
        row.setAttribute('data-selected', '');
        var cb = row.querySelector("[data-part='checkbox']"); if (cb) cb.checked = true;
      });
      updateHeaderCheckbox();
    }

    function deselectAll() {
      bodyRows().forEach(function(row) {
        row.removeAttribute('data-selected');
        var cb = row.querySelector("[data-part='checkbox']"); if (cb) cb.checked = false;
      });
      lastSelectedIndex = -1;
      updateHeaderCheckbox();
    }

    function getSelected() {
      return bodyRows().map(function(row, index) { return { row: row, index: index }; })
        .filter(function(o) { return o.row.hasAttribute('data-selected'); })
        .map(function(o) { return o.index; });
    }

    function selectRange(fromIndex, toIndex) {
      var start = Math.min(fromIndex, toIndex);
      var end = Math.max(fromIndex, toIndex);
      var rows = bodyRows();
      for (var i = start; i <= end; i++) {
        if (i >= 0 && i < rows.length) {
          rows[i].setAttribute('data-selected', '');
          var cb = rows[i].querySelector("[data-part='checkbox']"); if (cb) cb.checked = true;
        }
      }
      updateHeaderCheckbox();
    }

    function onHeaderClick(e) {
      var th = e.target.closest("[data-part='th'][data-sortable]");
      if (!th) return;
      var allHeaders = [].slice.call(thead ? thead.querySelectorAll("[data-part='th']") : []);
      var columnIndex = allHeaders.indexOf(th);
      if (columnIndex < 0) return;
      var currentSort = th.getAttribute('aria-sort');
      sort(columnIndex, currentSort === 'ascending' ? 'descending' : 'ascending');
    }

    function onHeaderCheckboxChange() {
      headerCheckbox.checked ? selectAll() : deselectAll();
    }

    function onRowCheckboxChange(e) {
      var checkbox = e.target.closest("[data-part='checkbox']");
      if (!checkbox || checkbox === headerCheckbox) return;
      var row = checkbox.closest("[data-part='tr']");
      if (!row || !(tbody && tbody.contains(row))) return;
      var rows = bodyRows();
      var index = rows.indexOf(row);
      if (index < 0) return;
      if (e.shiftKey && lastSelectedIndex >= 0) { e.preventDefault(); selectRange(lastSelectedIndex, index); return; }
      if (checkbox.checked) row.setAttribute('data-selected', '');
      else row.removeAttribute('data-selected');
      lastSelectedIndex = index;
      updateHeaderCheckbox();
    }

    function onRowClick(e) {
      if (e.target.closest("[data-part='checkbox']")) return;
      var row = e.target.closest("[data-part='tr']");
      if (!row || !(tbody && tbody.contains(row))) return;
      var rows = bodyRows();
      var index = rows.indexOf(row);
      if (index < 0) return;
      if (e.shiftKey && lastSelectedIndex >= 0) selectRange(lastSelectedIndex, index);
    }

    if (thead) thead.addEventListener('click', onHeaderClick);
    if (headerCheckbox) headerCheckbox.addEventListener('change', onHeaderCheckboxChange);
    if (tbody) tbody.addEventListener('change', onRowCheckboxChange);
    if (tbody) tbody.addEventListener('click', onRowClick);

    function destroy() {
      if (thead) thead.removeEventListener('click', onHeaderClick);
      if (headerCheckbox) headerCheckbox.removeEventListener('change', onHeaderCheckboxChange);
      if (tbody) tbody.removeEventListener('change', onRowCheckboxChange);
      if (tbody) tbody.removeEventListener('click', onRowClick);
      delete root._loomTable;
    }

    var api = { sort: sort, selectRow: selectRow, selectAll: selectAll, deselectAll: deselectAll, getSelected: getSelected, destroy: destroy };
    root._loomTable = api;
    return api;
  }

  // --- select-custom ---
  function createSelectCustom(root) {
    if (root._loomSelectCustom) return root._loomSelectCustom;

    var trigger = root.querySelector("[data-part='trigger']");
    var valueEl = root.querySelector("[data-part='value']");
    var listbox = root.querySelector("[data-part='listbox']");
    var searchInput = root.querySelector("[data-part='search']");
    var emptyEl = root.querySelector("[data-part='empty']");
    var getOptions = function() { return [].slice.call(root.querySelectorAll("[data-part='option']")); };

    var highlightedIndex = -1;
    var outsideClickCleanup = null;
    var selectedValue = '';

    function open() {
      root.dataset.state = 'open';
      listbox.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      if (searchInput) { searchInput.value = ''; filterOptions(''); searchInput.focus(); }
      clearHighlight();
      outsideClickCleanup = onOutsideClick(root, close);
    }

    function close() {
      root.dataset.state = 'closed';
      listbox.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      clearHighlight();
      if (outsideClickCleanup) { outsideClickCleanup(); outsideClickCleanup = null; }
      trigger.focus();
    }

    function toggle() { root.dataset.state === 'open' ? close() : open(); }

    function clearHighlight() {
      getOptions().forEach(function(opt) { opt.removeAttribute('data-highlighted'); });
      highlightedIndex = -1;
    }

    function visibleOptions() {
      return getOptions().filter(function(opt) { return !opt.hasAttribute('data-hidden'); });
    }

    function highlightOption(index) {
      var visible = visibleOptions();
      if (visible.length === 0) return;
      if (index < 0) index = visible.length - 1;
      if (index >= visible.length) index = 0;
      getOptions().forEach(function(opt) { opt.removeAttribute('data-highlighted'); });
      visible[index].setAttribute('data-highlighted', '');
      visible[index].scrollIntoView({ block: 'nearest' });
      highlightedIndex = index;
    }

    function filterOptions(query) {
      var allOptions = getOptions();
      var lowerQuery = query.toLowerCase();
      var visibleCount = 0;
      allOptions.forEach(function(opt) {
        if (opt.textContent.toLowerCase().includes(lowerQuery)) { opt.removeAttribute('data-hidden'); visibleCount++; }
        else opt.setAttribute('data-hidden', '');
      });
      if (emptyEl) emptyEl.hidden = visibleCount > 0;
      clearHighlight();
      return visibleCount;
    }

    function select(value) {
      var allOptions = getOptions();
      var targetOption = null;
      allOptions.forEach(function(opt) { if (opt.dataset.value === value) targetOption = opt; });
      if (!targetOption) allOptions.forEach(function(opt) { if (opt.textContent.trim() === value) targetOption = opt; });
      if (!targetOption) return;
      allOptions.forEach(function(opt) { opt.setAttribute('aria-selected', 'false'); });
      targetOption.setAttribute('aria-selected', 'true');
      selectedValue = targetOption.dataset.value || targetOption.textContent.trim();
      if (valueEl) { valueEl.textContent = targetOption.textContent.trim(); valueEl.removeAttribute('data-placeholder'); }
      root.dispatchEvent(new CustomEvent('select-change', { bubbles: true, detail: { value: selectedValue, label: targetOption.textContent.trim() } }));
      close();
    }

    function getValue() { return selectedValue; }

    function onTriggerClick() { toggle(); }
    function onTriggerKeyDown(e) {
      switch (e.key) {
        case 'ArrowDown': case 'Enter': case ' ': e.preventDefault(); if (root.dataset.state !== 'open') open(); break;
        case 'Escape': if (root.dataset.state === 'open') { e.preventDefault(); close(); } break;
      }
    }
    function onListboxKeyDown(e) {
      var visible = visibleOptions();
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); highlightOption(highlightedIndex + 1); break;
        case 'ArrowUp': e.preventDefault(); highlightOption(highlightedIndex - 1); break;
        case 'Enter': e.preventDefault(); if (highlightedIndex >= 0 && highlightedIndex < visible.length) { var opt = visible[highlightedIndex]; select(opt.dataset.value || opt.textContent.trim()); } break;
        case 'Escape': e.preventDefault(); close(); break;
        case 'Home': if (visible.length > 0) { e.preventDefault(); highlightOption(0); } break;
        case 'End': if (visible.length > 0) { e.preventDefault(); highlightOption(visible.length - 1); } break;
      }
    }
    function onOptionClick(e) {
      var opt = e.target.closest("[data-part='option']");
      if (opt) select(opt.dataset.value || opt.textContent.trim());
    }
    function onSearchInput() { if (searchInput) filterOptions(searchInput.value); }

    if (trigger) trigger.addEventListener('click', onTriggerClick);
    if (trigger) trigger.addEventListener('keydown', onTriggerKeyDown);
    if (listbox) listbox.addEventListener('keydown', onListboxKeyDown);
    if (listbox) listbox.addEventListener('click', onOptionClick);
    if (searchInput) searchInput.addEventListener('input', onSearchInput);

    function destroy() {
      if (trigger) trigger.removeEventListener('click', onTriggerClick);
      if (trigger) trigger.removeEventListener('keydown', onTriggerKeyDown);
      if (listbox) listbox.removeEventListener('keydown', onListboxKeyDown);
      if (listbox) listbox.removeEventListener('click', onOptionClick);
      if (searchInput) searchInput.removeEventListener('input', onSearchInput);
      if (outsideClickCleanup) outsideClickCleanup();
      delete root._loomSelectCustom;
    }

    var api = { open: open, close: close, toggle: toggle, select: select, getValue: getValue, destroy: destroy };
    root._loomSelectCustom = api;
    return api;
  }

  // --- popover ---
  function createPopover(root) {
    if (root._loomPopover) return root._loomPopover;

    var trigger = root.querySelector("[data-part='trigger']");
    var content = root.querySelector("[data-part='content']");
    var closeBtn = root.querySelector("[data-part='close']");
    var outsideClickCleanup = null;

    function open() {
      root.dataset.state = 'open';
      content.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      outsideClickCleanup = onOutsideClick(root, close);
    }

    function close() {
      root.dataset.state = 'closed';
      content.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (outsideClickCleanup) { outsideClickCleanup(); outsideClickCleanup = null; }
    }

    function toggle() { root.dataset.state === 'open' ? close() : open(); }

    function onTriggerClick() { toggle(); }
    function onCloseClick(e) { e.stopPropagation(); close(); }
    function onKeyDown(e) {
      if (e.key === 'Escape' && root.dataset.state === 'open') { e.preventDefault(); close(); trigger.focus(); }
    }

    if (trigger) trigger.addEventListener('click', onTriggerClick);
    if (closeBtn) closeBtn.addEventListener('click', onCloseClick);
    root.addEventListener('keydown', onKeyDown);

    function destroy() {
      if (trigger) trigger.removeEventListener('click', onTriggerClick);
      if (closeBtn) closeBtn.removeEventListener('click', onCloseClick);
      root.removeEventListener('keydown', onKeyDown);
      if (outsideClickCleanup) outsideClickCleanup();
      delete root._loomPopover;
    }

    var api = { open: open, close: close, toggle: toggle, destroy: destroy };
    root._loomPopover = api;
    return api;
  }

  // --- pagination ---
  function createPagination(root) {
    if (root._loomPagination) return root._loomPagination;

    var nav = root.querySelector("[data-part='nav']");
    var prevBtn = root.querySelector("[data-part='prev']");
    var nextBtn = root.querySelector("[data-part='next']");

    var currentPage = 1;
    var totalPages = 1;

    var activeBtn = root.querySelector("[data-part='page'][data-state='active']");
    if (activeBtn) currentPage = parseInt(activeBtn.dataset.page, 10) || 1;
    var allPageBtns = root.querySelectorAll("[data-part='page']");
    if (allPageBtns.length > 0) {
      totalPages = parseInt(allPageBtns[allPageBtns.length - 1].dataset.page, 10) || 1;
    }

    function getPageButtons() { return [].slice.call(root.querySelectorAll("[data-part='page']")); }

    function updateActiveState() {
      getPageButtons().forEach(function(btn) {
        var page = parseInt(btn.dataset.page, 10);
        if (page === currentPage) {
          btn.dataset.state = 'active';
          btn.setAttribute('aria-current', 'page');
        } else {
          delete btn.dataset.state;
          btn.removeAttribute('aria-current');
        }
      });
      if (prevBtn) prevBtn.disabled = currentPage <= 1;
      if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
    }

    function emitPageChange() {
      root.dispatchEvent(new CustomEvent('loom:page-change', { detail: { page: currentPage }, bubbles: true }));
    }

    function setPage(n) {
      var page = Math.max(1, Math.min(n, totalPages));
      if (page === currentPage) return;
      currentPage = page;
      updateActiveState();
      emitPageChange();
    }

    function getPage() { return currentPage; }

    function setTotal(n) {
      totalPages = Math.max(1, n);
      if (currentPage > totalPages) currentPage = totalPages;
      updateActiveState();
    }

    function onNavClick(e) {
      var pageBtn = e.target.closest("[data-part='page']");
      if (pageBtn) { var page = parseInt(pageBtn.dataset.page, 10); if (!isNaN(page)) setPage(page); }
    }
    function onPrevClick() { if (currentPage > 1) setPage(currentPage - 1); }
    function onNextClick() { if (currentPage < totalPages) setPage(currentPage + 1); }

    if (nav) nav.addEventListener('click', onNavClick);
    if (prevBtn) prevBtn.addEventListener('click', onPrevClick);
    if (nextBtn) nextBtn.addEventListener('click', onNextClick);
    updateActiveState();

    function destroy() {
      if (nav) nav.removeEventListener('click', onNavClick);
      if (prevBtn) prevBtn.removeEventListener('click', onPrevClick);
      if (nextBtn) nextBtn.removeEventListener('click', onNextClick);
      delete root._loomPagination;
    }

    var api = { setPage: setPage, getPage: getPage, setTotal: setTotal, destroy: destroy };
    root._loomPagination = api;
    return api;
  }

  // --- sheet ---
  function createSheet(root) {
    if (root._loomSheet) return root._loomSheet;

    var trigger = root.querySelector("[data-part='trigger']");
    var overlay = root.querySelector("[data-part='overlay']");
    var panel = root.querySelector("[data-part='panel']");
    var closeButtons = root.querySelectorAll("[data-part='close']");

    var focusCleanup = null;
    var previouslyFocused = null;

    function open() {
      previouslyFocused = document.activeElement;
      root.dataset.state = 'open';
      overlay.hidden = false;
      panel.hidden = false;
      focusCleanup = trapFocus(panel);
      if (panel.focus) panel.focus();
    }

    function close() {
      root.dataset.state = 'closing';
      var onEnd = function() {
        root.dataset.state = 'closed';
        overlay.hidden = true;
        panel.hidden = true;
        if (focusCleanup) focusCleanup();
        focusCleanup = null;
        if (previouslyFocused) previouslyFocused.focus();
        panel.removeEventListener('transitionend', onTransEnd);
      };
      var hasTransition = false;
      try {
        var style = getComputedStyle(panel);
        hasTransition = (parseFloat(style.transitionDuration) || 0) > 0;
      } catch (e) {}
      var onTransEnd = function(e) { if (e.propertyName === 'transform') onEnd(); };
      if (hasTransition) panel.addEventListener('transitionend', onTransEnd, { once: true });
      else onEnd();
    }

    function toggle() { root.dataset.state === 'open' ? close() : open(); }

    function onTriggerClick() { open(); }
    function onOverlayClick() { close(); }
    function onCloseClick() { close(); }
    function onKeyDown(e) {
      if (e.key === 'Escape' && root.dataset.state === 'open') { e.stopPropagation(); close(); }
    }

    if (trigger) trigger.addEventListener('click', onTriggerClick);
    if (overlay) overlay.addEventListener('click', onOverlayClick);
    closeButtons.forEach(function(btn) { btn.addEventListener('click', onCloseClick); });
    root.addEventListener('keydown', onKeyDown);

    function destroy() {
      if (trigger) trigger.removeEventListener('click', onTriggerClick);
      if (overlay) overlay.removeEventListener('click', onOverlayClick);
      closeButtons.forEach(function(btn) { btn.removeEventListener('click', onCloseClick); });
      root.removeEventListener('keydown', onKeyDown);
      if (focusCleanup) focusCleanup();
      delete root._loomSheet;
    }

    var api = { open: open, close: close, toggle: toggle, destroy: destroy };
    root._loomSheet = api;
    return api;
  }

  // --- date-picker ---
  var MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  var DAY_NAMES = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
  ];

  function createDatePicker(root) {
    if (root._loomDatePicker) return root._loomDatePicker;

    var trigger = root.querySelector("[data-part='trigger']");
    var input = root.querySelector("[data-part='input']");
    var calendar = root.querySelector("[data-part='calendar']");
    var navPrev = root.querySelector("[data-part='nav-prev']");
    var navNext = root.querySelector("[data-part='nav-next']");
    var monthLabel = root.querySelector("[data-part='month-label']");
    var gridBody = root.querySelector("[data-part='grid-body']");

    var today = new Date();
    var viewMonth = today.getMonth();
    var viewYear = today.getFullYear();
    var selectedDate = null;
    var focusedDate = null;
    var outsideClickCleanup = null;

    function formatDate(date) {
      var y = date.getFullYear();
      var m = String(date.getMonth() + 1).padStart(2, '0');
      var d = String(date.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }

    function formatDisplay(date) {
      return MONTH_NAMES[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
    }

    function formatAriaLabel(date) {
      return DAY_NAMES[date.getDay()] + ', ' + MONTH_NAMES[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
    }

    function isSameDay(a, b) {
      if (!a || !b) return false;
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }

    function isToday(date) { return isSameDay(date, today); }

    function buildCalendar() {
      var firstDay = new Date(viewYear, viewMonth, 1);
      var startDow = firstDay.getDay();
      var lastDay = new Date(viewYear, viewMonth + 1, 0);
      var totalDays = lastDay.getDate();
      var prevMonthLast = new Date(viewYear, viewMonth, 0);
      var prevMonthDays = prevMonthLast.getDate();

      monthLabel.textContent = MONTH_NAMES[viewMonth] + ' ' + viewYear;
      gridBody.innerHTML = '';

      var dayCount = 1;
      var nextMonthDay = 1;
      var totalCells = Math.ceil((startDow + totalDays) / 7) * 7;
      var row;

      for (var i = 0; i < totalCells; i++) {
        if (i % 7 === 0) {
          row = document.createElement('tr');
          gridBody.appendChild(row);
        }

        var td = document.createElement('td');
        var btn = document.createElement('button');
        btn.setAttribute('data-part', 'day');
        btn.type = 'button';

        var date;
        var isOutside = false;

        if (i < startDow) {
          var day = prevMonthDays - startDow + 1 + i;
          date = new Date(viewYear, viewMonth - 1, day);
          btn.textContent = day;
          isOutside = true;
        } else if (dayCount <= totalDays) {
          date = new Date(viewYear, viewMonth, dayCount);
          btn.textContent = dayCount;
          dayCount++;
        } else {
          date = new Date(viewYear, viewMonth + 1, nextMonthDay);
          btn.textContent = nextMonthDay;
          nextMonthDay++;
          isOutside = true;
        }

        btn.dataset.date = formatDate(date);
        btn.setAttribute('aria-label', formatAriaLabel(date));
        if (isOutside) btn.dataset.outside = 'true';
        if (isToday(date)) btn.dataset.today = 'true';
        if (isSameDay(date, selectedDate)) btn.setAttribute('aria-selected', 'true');
        btn.tabIndex = isSameDay(date, focusedDate) ? 0 : -1;

        td.appendChild(btn);
        row.appendChild(td);
      }

      if (!focusedDate) {
        var defaultFocusDate = selectedDate
          ? (selectedDate.getMonth() === viewMonth && selectedDate.getFullYear() === viewYear ? selectedDate : new Date(viewYear, viewMonth, 1))
          : new Date(viewYear, viewMonth, 1);
        var defaultBtn = gridBody.querySelector('[data-date="' + formatDate(defaultFocusDate) + '"]');
        if (defaultBtn) defaultBtn.tabIndex = 0;
      }
    }

    function dpOpen() {
      root.dataset.state = 'open';
      calendar.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      if (selectedDate) { viewMonth = selectedDate.getMonth(); viewYear = selectedDate.getFullYear(); }
      else { viewMonth = today.getMonth(); viewYear = today.getFullYear(); }
      focusedDate = selectedDate || new Date(viewYear, viewMonth, 1);
      buildCalendar();
      var focusBtn = gridBody.querySelector('[data-date="' + formatDate(focusedDate) + '"]');
      if (focusBtn) focusBtn.focus();
      outsideClickCleanup = onOutsideClick(root, dpClose);
    }

    function dpClose() {
      root.dataset.state = 'closed';
      calendar.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      focusedDate = null;
      if (outsideClickCleanup) { outsideClickCleanup(); outsideClickCleanup = null; }
    }

    function dpSelectDate(date) {
      selectedDate = new Date(date);
      input.value = formatDisplay(selectedDate);
      input.dataset.value = formatDate(selectedDate);
      buildCalendar();
      dpClose();
      input.focus();
      root.dispatchEvent(new CustomEvent('loom:date-change', {
        detail: { date: formatDate(selectedDate), dateObj: selectedDate }, bubbles: true
      }));
    }

    function getValue() { return selectedDate ? formatDate(selectedDate) : null; }

    function setValue(dateStr) {
      var parsed = new Date(dateStr + 'T00:00:00');
      if (!isNaN(parsed.getTime())) {
        selectedDate = parsed;
        input.value = formatDisplay(selectedDate);
        input.dataset.value = formatDate(selectedDate);
        viewMonth = selectedDate.getMonth();
        viewYear = selectedDate.getFullYear();
        if (root.dataset.state === 'open') buildCalendar();
      }
    }

    function navigate(month, year) {
      viewMonth = month; viewYear = year;
      focusedDate = new Date(viewYear, viewMonth, 1);
      buildCalendar();
      var focusBtn = gridBody.querySelector('[data-date="' + formatDate(focusedDate) + '"]');
      if (focusBtn) focusBtn.focus();
    }

    function moveFocus(days) {
      if (!focusedDate) return;
      var newDate = new Date(focusedDate);
      newDate.setDate(newDate.getDate() + days);
      focusedDate = newDate;
      if (newDate.getMonth() !== viewMonth || newDate.getFullYear() !== viewYear) {
        viewMonth = newDate.getMonth(); viewYear = newDate.getFullYear();
        buildCalendar();
      } else {
        gridBody.querySelectorAll("[data-part='day']").forEach(function(btn) { btn.tabIndex = -1; });
        var targetBtn = gridBody.querySelector('[data-date="' + formatDate(newDate) + '"]');
        if (targetBtn) { targetBtn.tabIndex = 0; targetBtn.focus(); }
      }
      var targetBtn = gridBody.querySelector('[data-date="' + formatDate(newDate) + '"]');
      if (targetBtn) targetBtn.focus();
    }

    function onTriggerClick() { root.dataset.state === 'open' ? dpClose() : dpOpen(); }
    function onGridClick(e) {
      var dayBtn = e.target.closest("[data-part='day']");
      if (dayBtn && dayBtn.dataset.date) dpSelectDate(new Date(dayBtn.dataset.date + 'T00:00:00'));
    }
    function onPrevClick() {
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      focusedDate = new Date(viewYear, viewMonth, 1);
      buildCalendar();
    }
    function onNextClick() {
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      focusedDate = new Date(viewYear, viewMonth, 1);
      buildCalendar();
    }
    function onCalendarKeyDown(e) {
      switch (e.key) {
        case 'ArrowLeft': e.preventDefault(); moveFocus(-1); break;
        case 'ArrowRight': e.preventDefault(); moveFocus(1); break;
        case 'ArrowUp': e.preventDefault(); moveFocus(-7); break;
        case 'ArrowDown': e.preventDefault(); moveFocus(7); break;
        case 'Enter': case ' ': e.preventDefault(); if (focusedDate) dpSelectDate(focusedDate); break;
        case 'Escape': e.preventDefault(); dpClose(); input.focus(); break;
      }
    }
    function onRootKeyDown(e) {
      if (e.key === 'Escape' && root.dataset.state === 'open') { e.preventDefault(); dpClose(); input.focus(); }
    }

    if (trigger) trigger.addEventListener('click', onTriggerClick);
    if (gridBody) gridBody.addEventListener('click', onGridClick);
    if (navPrev) navPrev.addEventListener('click', onPrevClick);
    if (navNext) navNext.addEventListener('click', onNextClick);
    if (calendar) calendar.addEventListener('keydown', onCalendarKeyDown);
    root.addEventListener('keydown', onRootKeyDown);

    function destroy() {
      if (trigger) trigger.removeEventListener('click', onTriggerClick);
      if (gridBody) gridBody.removeEventListener('click', onGridClick);
      if (navPrev) navPrev.removeEventListener('click', onPrevClick);
      if (navNext) navNext.removeEventListener('click', onNextClick);
      if (calendar) calendar.removeEventListener('keydown', onCalendarKeyDown);
      root.removeEventListener('keydown', onRootKeyDown);
      if (outsideClickCleanup) outsideClickCleanup();
      delete root._loomDatePicker;
    }

    var api = { open: dpOpen, close: dpClose, getValue: getValue, setValue: setValue, navigate: navigate, selectDate: dpSelectDate, destroy: destroy };
    root._loomDatePicker = api;
    return api;
  }

  // --- Controller Registration ---
  controllerRegistry['dialog'] = createDialog;
  controllerRegistry['drawer'] = createDrawer;
  controllerRegistry['tabs'] = createTabs;
  controllerRegistry['dropdown'] = createDropdown;
  controllerRegistry['accordion'] = createAccordion;
  controllerRegistry['tooltip'] = createTooltip;
  controllerRegistry['toast'] = createToastContainer;
  controllerRegistry['combobox'] = createCombobox;
  controllerRegistry['command-palette'] = createCommandPalette;
  controllerRegistry['table'] = createTable;
  controllerRegistry['select-custom'] = createSelectCustom;
  controllerRegistry['popover'] = createPopover;
  controllerRegistry['pagination'] = createPagination;
  controllerRegistry['sheet'] = createSheet;
  controllerRegistry['date-picker'] = createDatePicker;

  // ═══════════════════════════════════════════════════════
  // Section 8: Global API
  // ═══════════════════════════════════════════════════════

  var customMagics = new Map();

  function findParentScope(el) {
    var parent = el.parentElement;
    while (parent) {
      if (parent.__loomScope) return parent.__loomScope;
      parent = parent.parentElement;
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════
  // Section 9: Bootstrap & Auto-init
  // ═══════════════════════════════════════════════════════

  function bootstrap() {
    injectCloakStyle();

    // Auto-init controllers for all [data-ui] elements
    var names = Object.keys(controllerRegistry);
    for (var n = 0; n < names.length; n++) {
      var els = document.querySelectorAll('[data-ui="' + names[n] + '"]');
      for (var e = 0; e < els.length; e++) {
        controllerRegistry[names[n]](els[e]);
      }
    }

    // Find all scope roots.
    // l-data elements always create a scope.
    // data-ui elements only create a scope when standalone (no l-data ancestor).
    var roots = document.querySelectorAll('[l-data], [data-ui]');
    var processed = new Set();

    for (var r = 0; r < roots.length; r++) {
      var rootEl = roots[r];
      if (processed.has(rootEl)) continue;

      // Skip if nested inside an unprocessed ancestor l-data scope
      var ancestor = rootEl.parentElement;
      var skipThis = false;
      while (ancestor) {
        if (ancestor.hasAttribute('l-data') && !processed.has(ancestor)) {
          skipThis = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }

      // data-ui elements without l-data only need a scope if they are standalone
      // (not inside any l-data). If inside an l-data, they inherit that scope via walkChildren.
      if (!skipThis && !rootEl.hasAttribute('l-data') && rootEl.hasAttribute('data-ui')) {
        // Check if this data-ui is inside a processed l-data scope — if so, skip
        var lDataAncestor = rootEl.parentElement;
        while (lDataAncestor) {
          if (lDataAncestor.hasAttribute('l-data') && processed.has(lDataAncestor)) {
            skipThis = true;
            break;
          }
          lDataAncestor = lDataAncestor.parentElement;
        }
      }

      if (!skipThis) {
        initTree(rootEl, null);
        var descendants = rootEl.querySelectorAll('[l-data]');
        for (var d = 0; d < descendants.length; d++) processed.add(descendants[d]);
        processed.add(rootEl);
      }
    }

    removeCloaks();

    // MutationObserver for dynamically added elements
    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var addedNodes = mutations[i].addedNodes;
        for (var j = 0; j < addedNodes.length; j++) {
          var node = addedNodes[j];
          if (node.nodeType !== 1) continue;

          var uiName = node.getAttribute ? node.getAttribute('data-ui') : null;
          if (uiName && controllerRegistry[uiName]) {
            controllerRegistry[uiName](node);
          }

          if (node.hasAttribute && node.hasAttribute('l-data')) {
            initTree(node, findParentScope(node));
          } else if (node.hasAttribute && node.hasAttribute('data-ui') && !findParentScope(node)) {
            // Standalone data-ui (no parent scope) — create its own scope
            initTree(node, null);
          }

          if (node.querySelectorAll) {
            var cNames = Object.keys(controllerRegistry);
            for (var cn = 0; cn < cNames.length; cn++) {
              var cEls = node.querySelectorAll('[data-ui="' + cNames[cn] + '"]');
              for (var ce = 0; ce < cEls.length; ce++) controllerRegistry[cNames[cn]](cEls[ce]);
            }
            var scopeEls = node.querySelectorAll('[l-data]');
            for (var se = 0; se < scopeEls.length; se++) {
              if (!scopeEls[se].__loomScope) {
                initTree(scopeEls[se], findParentScope(scopeEls[se]));
              }
            }
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Auto-start logic
  var currentScript = typeof document !== 'undefined' ? document.currentScript : null;
  var isManual = currentScript && currentScript.hasAttribute('data-manual');

  if (!isManual && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
      bootstrap();
    }
  }

  // ═══════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════

  var Loom = {
    version: '0.1.0',
    reactive: reactive,
    effect: effect,
    batch: batch,
    untrack: untrack,
    evaluate: evaluate,
    evaluateAssignment: evaluateAssignment,
    nextTick: function(fn) { return queueMicrotask(fn || function() {}); },
    data: function(name, factory) { dataRegistry.set(name, factory); },
    store: function(name, obj) { globalStores[name] = reactive(obj); },
    directive: function(name, handler) { customDirectives.set(name, handler); },
    magic: function(name, callback) { customMagics.set(name, callback); },
    plugin: function(fn) { fn(Loom); },
    controller: function(name, factory) { controllerRegistry[name] = factory; },
    start: bootstrap,
    initTree: initTree
  };

  return Loom;
});
