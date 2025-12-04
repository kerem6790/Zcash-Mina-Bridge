import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
    ZEC_RPC_URL: process.env.ZEC_RPC_URL || 'http://127.0.0.1:8232',
    ZEC_RPC_USER: process.env.ZEC_RPC_USER || 'user',
    ZEC_RPC_PASS: process.env.ZEC_RPC_PASS || 'password',

    MINA_RPC_URL: process.env.MINA_RPC_URL || 'https://api.minascan.io/node/devnet/v1/graphql',
    ORACLE_PRIVATE_KEY: process.env.ORACLE_PRIVATE_KEY || '',
    ZKAPP_ADDRESS: process.env.ZKAPP_ADDRESS || '',

    POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS || '30000'),
    CONFIRMATIONS: parseInt(process.env.CONFIRMATIONS || '10'),
};
