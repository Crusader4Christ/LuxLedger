export type ContractCheck = {
  name: string;
  assert: () => void;
};

export type ContractHarness = {
  run: (checks: ContractCheck[]) => void;
};

export const createContractHarness = (): ContractHarness => ({
  run: (checks) => {
    for (const check of checks) {
      check.assert();
    }
  },
});
