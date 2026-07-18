export type ContractCheck = {
  name: string;
  assert: () => void;
};

export type ContractAdapterRunner = {
  name: 'fastify' | 'express';
};

export type ContractHarness = {
  run: (checks: ContractCheck[]) => void;
  runForAdapters: (adapters: ContractAdapterRunner[], checks: ContractCheck[]) => void;
};

export const createContractHarness = (): ContractHarness => ({
  run: (checks) => {
    for (const check of checks) {
      check.assert();
    }
  },
  runForAdapters: (adapters, checks) => {
    for (const adapter of adapters) {
      for (const check of checks) {
        check.assert();
      }
      if (adapter.name !== 'fastify' && adapter.name !== 'express') {
        throw new Error(`Unsupported adapter: ${adapter.name satisfies never}`);
      }
    }
  },
});
