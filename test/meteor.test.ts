import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/browser/meteor.js';

const sdk = vi.hoisted(() => ({
  initialize: vi.fn(), createAction: vi.fn(), prompt: vi.fn(), getAccount: vi.fn(),
  removeSignedInAccount: vi.fn(), setEnvConfig: vi.fn(), convertSelectorActionToNearAction: vi.fn()
}));
vi.mock('@meteorwallet/sdk', () => ({
  MeteorConnect: class {
    initialize = sdk.initialize;
    createAction = sdk.createAction;
    getAccount = sdk.getAccount;
    removeSignedInAccount = sdk.removeSignedInAccount;
  },
  setEnvConfig: sdk.setEnvConfig,
  convertSelectorActionToNearAction: sdk.convertSelectorActionToNearAction,
  webpage_local_storage: { name: 'browser-storage' }
}));
const config = { network: 'testnet' as const, authReceiver: 'treasury.testnet', walletUrl: 'https://wallet.meteorwallet.app' };
const account = { identifier: { blockchain: 'near', network: 'testnet', accountId: 'alice.testnet' } };
beforeEach(() => {
  vi.resetAllMocks();
  sdk.initialize.mockResolvedValue(undefined);
  sdk.createAction.mockImplementation(async () => ({ promptForExecution: sdk.prompt }));
  sdk.getAccount.mockResolvedValue(account);
});

describe('official Meteor Wallet adapter', () => {
  it('prompts for each message approval and includes its exact account and request', async () => {
    const proof = { accountId: 'alice.testnet', publicKey: { toString: () => 'ed25519:wallet-key' }, signature: new Uint8Array([1, 2]) };
    sdk.prompt.mockResolvedValue(proof);
    const client = await createClient(config);
    const params = { message: 'Approve this agent action: withdraw 1 NEAR', recipient: 'mandate', nonce: new Uint8Array(32) };
    await client.signMessage('alice.testnet', params);
    await client.signMessage('alice.testnet', params);
    expect(sdk.createAction).toHaveBeenCalledTimes(2);
    expect(sdk.prompt).toHaveBeenCalledTimes(2);
    expect(sdk.createAction).toHaveBeenCalledWith({ id: 'near::sign_message', input: {
      target: { blockchain: 'near', network: 'testnet', accountId: 'alice.testnet' }, messageParams: params
    } });
  });

  it('blocks a message approval when connection selects a different account', async () => {
    sdk.getAccount.mockResolvedValue(undefined);
    sdk.prompt.mockResolvedValue({ identifier: { ...account.identifier, accountId: 'bob.testnet' } });
    const client = await createClient(config);
    await expect(client.signMessage('alice.testnet', { message: 'Withdraw 1 NEAR', recipient: 'mandate', nonce: new Uint8Array(32) })).rejects.toThrow('alice.testnet');
    expect(sdk.createAction).toHaveBeenCalledTimes(1);
    expect(sdk.createAction.mock.calls[0][0].id).toBe('near::sign_in');
  });

  it.each(['testnet', 'mainnet'] as const)('requests only the authentication method on %s', async network => {
    sdk.prompt.mockResolvedValue({ identifier: { ...account.identifier, network } });
    const client = await createClient({ ...config, network });
    expect(await client.signIn('ed25519:auth-key')).toBe('alice.testnet');
    expect(sdk.setEnvConfig).toHaveBeenCalledWith({ wallet_base_url: config.walletUrl });
    expect(sdk.createAction).toHaveBeenCalledWith({
      id: 'near::sign_in', input: {
        target: { blockchain: 'near', network },
        addFunctionCallKey: { publicKey: 'ed25519:auth-key', contractId: config.authReceiver,
          allowMethods: { anyMethod: false, methodNames: ['mandate_auth'] } }
      }
    });
  });

  it('uses a wallet approval to send a deposit and returns its receipt', async () => {
    const outcome = { transaction: { hash: 'deposit-hash' } };
    sdk.prompt.mockResolvedValue([outcome]);
    const nativeAction = { transfer: { deposit: 1n } };
    sdk.convertSelectorActionToNearAction.mockReturnValue(nativeAction);
    const client = await createClient(config);
    const actions = [{ type: 'Transfer' as const, params: { deposit: '1' } }];
    expect(await client.signAndSendTransaction({ signerId: 'alice.testnet', receiverId: 'agent.testnet', actions })).toEqual(outcome);
    expect(sdk.getAccount).toHaveBeenCalledWith({ blockchain: 'near', network: 'testnet', accountId: 'alice.testnet' }, false);
    expect(sdk.createAction).toHaveBeenCalledWith({
      id: 'near::sign_transactions', input: {
        target: { blockchain: 'near', network: 'testnet', accountId: 'alice.testnet' },
        useFunctionCallKey: false,
        transactions: [{ receiverId: 'agent.testnet', actions: [nativeAction] }]
      }
    });
  });

  it('connects an address-only profile before a deposit and blocks the wrong account', async () => {
    sdk.getAccount.mockResolvedValue(undefined);
    sdk.prompt.mockResolvedValue({ identifier: { ...account.identifier, accountId: 'bob.testnet' } });
    const client = await createClient(config);
    await expect(client.signAndSendTransaction({ signerId: 'alice.testnet', receiverId: 'agent.testnet', actions: [] })).rejects.toThrow('alice.testnet');
    expect(sdk.createAction).toHaveBeenCalledTimes(1);
    expect(sdk.createAction).toHaveBeenCalledWith({ id: 'near::sign_in', input: { target: { blockchain: 'near', network: 'testnet' } } });
  });

  it('disconnects locally without requesting another on-chain wallet action', async () => {
    const client = await createClient(config);
    await client.disconnect('alice.testnet');
    expect(sdk.removeSignedInAccount).toHaveBeenCalledWith({ blockchain: 'near', network: 'testnet', accountId: 'alice.testnet' });
    expect(sdk.createAction).not.toHaveBeenCalled();
  });
});
