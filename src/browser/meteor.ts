import { MeteorConnect, convertSelectorActionToNearAction, setEnvConfig, webpage_local_storage } from '@meteorwallet/sdk';

// The official SDK handles Meteor's web popup and extension transport.
interface WalletConfig { network: 'testnet' | 'mainnet'; walletUrl: string; authReceiver: string; }
interface WalletTransaction {
  signerId: string;
  receiverId: string;
  actions: Array<Parameters<typeof convertSelectorActionToNearAction>[0]>;
}

export async function createClient(config: WalletConfig) {
  setEnvConfig({ wallet_base_url: config.walletUrl });
  const meteor = new MeteorConnect();
  await meteor.initialize({ storage: webpage_local_storage });
  const networkTarget = { blockchain: 'near' as const, network: config.network };
  const target = (accountId: string) => ({ ...networkTarget, accountId });

  async function signIn(publicKey?: string) {
    const action = await meteor.createAction({
      id: 'near::sign_in',
      input: {
        target: networkTarget,
        ...(publicKey ? { addFunctionCallKey: {
          publicKey,
          contractId: config.authReceiver,
          allowMethods: { anyMethod: false, methodNames: ['mandate_auth'] }
        } } : {})
      }
    });
    const account = await action.promptForExecution();
    if (account.identifier.network !== config.network || !account.identifier.accountId) throw new Error('Connect a Meteor account on ' + config.network + '.');
    return account.identifier.accountId;
  }

  async function ensureAccount(accountId: string) {
    if (!await meteor.getAccount(target(accountId), false) && await signIn() !== accountId) {
      throw new Error('Sign using your linked account: ' + accountId + '.');
    }
  }

  return {
    signIn,
    isConnected: async (accountId: string) => !!await meteor.getAccount(target(accountId), false),
    async signMessage(accountId: string, messageParams: { message: string; recipient: string; nonce: Uint8Array }) {
      const action = await meteor.createAction({ id: 'near::sign_message', input: { target: target(accountId), messageParams } });
      const proof = await action.promptForExecution();
      return { accountId: proof.accountId, publicKey: proof.publicKey.toString(), signature: proof.signature };
    },
    async signAndSendTransaction(transaction: WalletTransaction) {
      await ensureAccount(transaction.signerId);
      const action = await meteor.createAction({
        id: 'near::sign_transactions',
        input: {
          target: target(transaction.signerId),
          useFunctionCallKey: false,
          transactions: [{ receiverId: transaction.receiverId, actions: transaction.actions.map(convertSelectorActionToNearAction) }]
        }
      });
      return (await action.promptForExecution())[0];
    },
    disconnect: (accountId: string) => meteor.removeSignedInAccount(target(accountId))
  };
}
