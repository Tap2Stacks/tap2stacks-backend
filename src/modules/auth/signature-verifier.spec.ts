import { describe, expect, it, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  ContractSignatureClient,
  createSignatureVerifier,
} from './signature-verifier';

const MESSAGE = 'Sign this message to log in to tap2stacks: test-nonce';

function clientReturning(result: boolean | Error): ContractSignatureClient & {
  verifyMessage: ReturnType<typeof vi.fn>;
} {
  return {
    verifyMessage: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

describe('createSignatureVerifier', () => {
  it('accepts a plain wallet signature without calling the chain', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const signature = await account.signMessage({ message: MESSAGE });
    const client = clientReturning(new Error('chain must not be called'));

    const ok = await createSignatureVerifier(client).verify(account.address, MESSAGE, signature);

    expect(ok).toBe(true);
    expect(client.verifyMessage).not.toHaveBeenCalled();
  });

  it('accepts a lowercase address for a plain wallet signature', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const signature = await account.signMessage({ message: MESSAGE });

    const ok = await createSignatureVerifier(clientReturning(false)).verify(
      account.address.toLowerCase(),
      MESSAGE,
      signature,
    );

    expect(ok).toBe(true);
  });

  it('falls back to the chain check for a smart wallet signature', async () => {
    const smartWallet = privateKeyToAccount(generatePrivateKey()).address;
    const signer = privateKeyToAccount(generatePrivateKey());
    const signature = await signer.signMessage({ message: MESSAGE });
    const client = clientReturning(true);

    const ok = await createSignatureVerifier(client).verify(smartWallet, MESSAGE, signature);

    expect(ok).toBe(true);
    expect(client.verifyMessage).toHaveBeenCalledWith({
      address: smartWallet,
      message: MESSAGE,
      signature,
    });
  });

  it('rejects when neither the local nor the chain check passes', async () => {
    const other = privateKeyToAccount(generatePrivateKey()).address;
    const signer = privateKeyToAccount(generatePrivateKey());
    const signature = await signer.signMessage({ message: MESSAGE });

    const ok = await createSignatureVerifier(clientReturning(false)).verify(other, MESSAGE, signature);

    expect(ok).toBe(false);
  });

  it('rejects when the chain check errors', async () => {
    const other = privateKeyToAccount(generatePrivateKey()).address;
    const signature = await privateKeyToAccount(generatePrivateKey()).signMessage({ message: MESSAGE });

    const ok = await createSignatureVerifier(clientReturning(new Error('rpc down'))).verify(
      other,
      MESSAGE,
      signature,
    );

    expect(ok).toBe(false);
  });

  it.each([
    ['not hex', 'hello'],
    ['empty', ''],
  ])('rejects a malformed signature (%s) without calling the chain', async (_label, signature) => {
    const address = privateKeyToAccount(generatePrivateKey()).address;
    const client = clientReturning(true);

    const ok = await createSignatureVerifier(client).verify(address, MESSAGE, signature);

    expect(ok).toBe(false);
    expect(client.verifyMessage).not.toHaveBeenCalled();
  });

  it('rejects a malformed address without calling the chain', async () => {
    const signature = await privateKeyToAccount(generatePrivateKey()).signMessage({ message: MESSAGE });
    const client = clientReturning(true);

    const ok = await createSignatureVerifier(client).verify('0x1234', MESSAGE, signature);

    expect(ok).toBe(false);
    expect(client.verifyMessage).not.toHaveBeenCalled();
  });
});
