import { privateKeyToAccount } from 'viem/accounts';
import { Chain, defineChain } from 'viem';
import { createPublicClient, createWalletClient, http, WalletClient, PublicClient } from 'viem';
import { StorageHubClient } from '@storagehub-sdk/core';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { types } from '@storagehub/types-bundle';
import 'dotenv/config';
import { NETWORKS } from '../config/networks.js';

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const address = account.address;

const chain: Chain = defineChain({
  id: NETWORKS.testnet.id,
  name: NETWORKS.testnet.name,
  nativeCurrency: NETWORKS.testnet.nativeCurrency,
  rpcUrls: { default: { http: [NETWORKS.testnet.rpcUrl] } },
});

const walletClient: WalletClient = createWalletClient({
  chain,
  account,
  transport: http(NETWORKS.testnet.rpcUrl),
});

const publicClient: PublicClient = createPublicClient({
  chain,
  transport: http(NETWORKS.testnet.rpcUrl),
});

// Create StorageHub client
// Used for interacting with the StorageHub network APIs,
// including creating buckets, issuing storage requests, uploading or deleting files, and managing storage proofs.
const storageHubClient: StorageHubClient = new StorageHubClient({
  rpcUrl: NETWORKS.testnet.rpcUrl,
  chain: chain,
  walletClient: walletClient,
  filesystemContractAddress: '0x0000000000000000000000000000000000000404' as `0x${string}`,
});

// Create Polkadot API client
// Used for reading core chain logic and state data from the underlying DataHaven Substrate node.
const provider = new WsProvider(NETWORKS.testnet.wsUrl);
const polkadotApi: ApiPromise = await ApiPromise.create({
  provider,
  typesBundle: types,
  noInitWarn: true,
});

export { account, address, publicClient, walletClient, storageHubClient, polkadotApi };
