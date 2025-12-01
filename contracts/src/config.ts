import { PublicKey } from 'o1js';
import dotenv from 'dotenv';

dotenv.config();

export const MINA_GRAPHQL_ENDPOINT = process.env.MINA_GRAPHQL_ENDPOINT || 'https://api.minascan.io/node/devnet/v1/graphql';
export const ZECBRIDGE_ADDRESS = process.env.ZKAPP_ADDRESS || 'B62qnHWafr5CZifyPQpFTsv3dD1YYC9zh1nctAUqeiAr6oMYrE8Mroe'; // Default from previous deploy
export const MAKER_PUBLIC_KEY = process.env.MINA_PUBLIC_KEY || ''; // User1
export const DEPLOYER_PRIVATE_KEY = process.env.MINA_PRIVATE_KEY || '';

if (!DEPLOYER_PRIVATE_KEY) {
    console.warn("WARNING: MINA_PRIVATE_KEY not set in .env");
}

export const ZCASH_RPC_URL = process.env.ZCASH_RPC_URL || 'http://127.0.0.1:18232';
export const ZCASH_RPC_USER = process.env.ZCASH_USER ?? '';
export const ZCASH_RPC_PASS = process.env.ZCASH_PASS ?? '';
