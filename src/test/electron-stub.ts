// "electron" nos testes (o pacote só existe em desktop/). Cada teste troca por vi.mock.
export const contextBridge = {
  exposeInMainWorld: (_key: string, _api: unknown) => undefined,
};
export const ipcRenderer = {
  invoke: async (_channel: string, ..._args: unknown[]): Promise<never> => {
    throw new Error("ipcRenderer.invoke não existe nos testes.");
  },
};
