// dsh-aurora-glass — offline smoke test (no browser, no bundler).
//
// Loads lib/client.js exactly the way the DSH web shell does — as a classic
// script that calls window.__ModuleLoader__.load({ id, factory }) — then
// materializes the factory with a stubbed module table and drives the exported
// plugin `apply` against a minimal Cordis context. It asserts:
//   - the bundle registers under the package name,
//   - the exports carry `apply` + the service `inject` list,
//   - apply() registers the locale dictionaries and one Settings section,
//   - the section label and inject face resolve against the dictionaries and
//     the plugin entry's config form.
// Run: node tools/smoke-test.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8');

let registration = null;
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(entry) { registration = entry; }
    }
  },
  console
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'lib/client.js' });

function assert(condition, message) {
  if (!condition) {
    console.error(`✗ ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ ${message}`);
  }
}

assert(registration !== null, 'bundle registers itself on window.__ModuleLoader__');
assert(registration.id === 'dsh-aurora-glass', `registers under package id (got ${registration && registration.id})`);

const reactStub = {
  createElement() { return {}; },
  useState() { return [undefined, () => {}]; },
  useEffect() {},
  useRef() { return { current: null }; },
  useSyncExternalStore() { return undefined; }
};

let exportsBag;
try {
  exportsBag = registration.factory((specifier) => {
    if (specifier === 'react') return reactStub;
    throw new Error(`unexpected runtime require: ${specifier}`);
  });
} catch (error) {
  console.error('factory materialization failed:', error);
  process.exit(1);
}

assert(typeof exportsBag.apply === 'function', 'client exports an apply() plugin body');
assert(Array.isArray(exportsBag.inject), 'client exports the service inject list');
assert(
  ['slots', 'locale', 'remote', 'configForms'].every((s) => exportsBag.inject.includes(s)),
  `inject list covers required services (${JSON.stringify(exportsBag.inject)})`
);

// ── minimal Cordis-like context ──────────────────────────────────────────
const locales = {};
const registeredSections = [];
const scopeState = {
  status: 'ready',
  value: { enabled: false, preset: 'aurora', image: '', dim: 35, glass: 55 },
  writable: true,
  revision: 0,
  base: undefined,
  user: undefined,
  mode: 'host'
};
const calls = { set: [], unset: [], entries: [], served: [] };
// The Host answers a refused write by resolving `false`; flip this to model a
// Host that rejects (a read-only deployment, or a stuck reload transaction).
const scopeControl = { refuse: false };

const ctx = {
  effect(fn) { const ret = fn(); return typeof ret === 'function' ? ret : () => {}; },
  locale: {
    register(ns, dicts) { locales[ns] = dicts; },
    bind(ns) {
      return (key) => {
        const dict = locales[ns];
        return dict && dict.en ? dict.zh[key] ?? key : key;
      };
    }
  },
  configForms: {
    get(entryId) {
      calls.entries.push(entryId);
      return {
        entryId,
        getSnapshot: () => scopeState,
        subscribe: () => () => {},
        set(field, value) { calls.set.push([field, value]); return Promise.resolve(scopeControl.refuse ? false : undefined); },
        unset(field) { calls.unset.push(field); return Promise.resolve(scopeControl.refuse ? false : undefined); }
      };
    },
    // The real service registers the contribution once the Host serves the
    // namespace; here we drive it directly and hand back its disposer.
    whileServed(namespaces, register) {
      calls.served.push(namespaces);
      const dispose = register(namespaces);
      return typeof dispose === 'function' ? dispose : () => {};
    }
  },
  slots: {
    inject(name, factory) {
      // The real framework runs the registration factory when the slot ledger
      // settles; here we drive it directly so the register() call happens.
      if (typeof factory === 'function') factory();
      return () => {};
    },
    register(options, component) {
      // The real ledger stores the entry; here we capture it for assertions
      // and return the disposer the framework would receive.
      registeredSections.push({ options, component });
      return () => {};
    }
  }
};

// Bind before register so label functions resolve zh live (register effect runs
// first inside apply, so this exercises the real ordering).
let zhDict;
ctx.locale.bind = (ns) => (key) => (zhDict && zhDict[key]) ?? key;
locales['settings.auroraGlass'] = {};
try {
  exportsBag.apply(ctx);
} catch (error) {
  console.error('apply() failed:', error);
  process.exit(1);
}
zhDict = locales['settings.auroraGlass'] && locales['settings.auroraGlass'].zh
  ? locales['settings.auroraGlass'].zh
  : {};

assert(locales['settings.auroraGlass'] && locales['settings.auroraGlass'].zh,
  'zh dictionary registered under settings.auroraGlass');
assert(zhDict.nav && typeof zhDict.nav === 'string', 'dictionary contains the nav label');
assert(registeredSections.length === 1, 'exactly one Settings section registered');

const section = registeredSections[0];
assert(section.options && section.options.name === 'settings.section', 'section targets the settings.section slot');
assert(section.options.id === 'aurora-glass', 'section id is aurora-glass');
assert(calls.entries.includes('aurora-glass'), `form resolved by the plugin entry id (got ${JSON.stringify(calls.entries)})`);
assert(
  calls.served.length === 1 && calls.served[0].length === 1 && calls.served[0][0] === 'aurora-glass',
  `page registration follows the served namespace (got ${JSON.stringify(calls.served)})`
);
assert(typeof section.options.label === 'function' && section.options.label() === zhDict.nav,
  `section label resolves through locale (got ${section.options.label && section.options.label()})`);

const injectedProps = section.options.inject();
const face = injectedProps && injectedProps.face;
assert(face && typeof face.getSnapshot === 'function' && typeof face.subscribe === 'function',
  'inject face exposes snapshot/subscribe for useSyncExternalStore');
assert(typeof face.preview === 'function' && typeof face.update === 'function' && typeof face.reset === 'function',
  'inject face exposes preview/update/reset actions');
assert(face.getSnapshot().value.enabled === false, 'scope snapshot resolves defaults');

// Reset should unset every known field through the scope API.
face.reset().then((accepted) => {
  const expected = ['enabled', 'preset', 'image', 'dim', 'glass'];
  const ok = expected.every((f) => calls.unset.includes(f));
  assert(ok, `reset() unsets all five fields (got ${JSON.stringify(calls.unset)})`);
  assert(accepted === true, `reset() reports an accepted write (got ${accepted})`);
  assert(typeof face.adopt === 'function', 'face exposes adopt so a refused write can be rolled back');

  face.update({ preset: 'ocean' }).then(() => {
    assert(calls.set.some(([f]) => f === 'preset'), 'update() writes through the settings scope');

    // A Host that refuses resolves `false` rather than rejecting, so the
    // section has to read the resolved value; otherwise the click is silent.
    scopeControl.refuse = true;
    face.reset().then((refused) => {
      assert(refused === false, `reset() reports a refused write (got ${refused})`);
      console.log(process.exitCode ? '\nSMOKE TEST FAILED' : '\nSMOKE TEST PASSED');
    });
  });
});
