// Vitest setup — runs before every test file.
//
// Node 26 ships its own experimental `localStorage` global. Without `--localstorage-file` it is
// installed as a getter on globalThis that returns `undefined` and warns. In vitest's jsdom
// environment `window === globalThis`, so that getter *shadows* the Storage jsdom installs, and
// every `window.localStorage.setItem` in the mock backend throws
// "Cannot read properties of undefined (reading 'setItem')" — 108 of 317 tests on Node 26.
//
// Nothing is wrong with the application code: the same suite is green on Node 22 (the toolchain
// this repo was built against, see server/README.md) and green here once Storage exists again.
//
// So: if and only if `localStorage` is missing under jsdom, install a minimal in-memory Storage.
// The guard matters — on Node 22, or in a real browser, jsdom's own Storage is left untouched.
// A Map is a faithful stand-in for how this app uses it (role key and delta blob, same-origin,
// synchronous, no quota and no StorageEvent listeners).
if (typeof globalThis.localStorage === "undefined") {
  class MemoryStorage implements Storage {
    private entries = new Map<string, string>();
    get length(): number {
      return this.entries.size;
    }
    clear(): void {
      this.entries.clear();
    }
    getItem(key: string): string | null {
      return this.entries.has(key) ? this.entries.get(key)! : null;
    }
    key(index: number): string | null {
      return Array.from(this.entries.keys())[index] ?? null;
    }
    removeItem(key: string): void {
      this.entries.delete(key);
    }
    setItem(key: string, value: string): void {
      this.entries.set(key, String(value));
    }
  }

  for (const name of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(globalThis, name, {
      value: new MemoryStorage(),
      configurable: true,
      writable: true,
    });
  }
}
