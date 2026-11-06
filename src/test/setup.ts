import "@testing-library/jest-dom/vitest";

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Node 22+ expõe um localStorage global que fica indefinido sem --localstorage-file e esconde
// o do jsdom. Nesse caso, usa um Storage em memória.
if (!globalThis.localStorage) {
  const data = new Map<string, string>();
  const memoryStorage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, String(value)),
  };
  Object.setPrototypeOf(memoryStorage, Storage.prototype);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memoryStorage });
}
