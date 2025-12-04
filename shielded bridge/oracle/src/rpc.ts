import axios from 'axios';
import { CONFIG } from './config';

export interface ZcashBlock {
    hash: string;
    height: number;
    orchard_tree?: {
        root: string;
    };
    finalorchardroot?: string;
}

export class ZcashRPC {
    private async call(method: string, params: any[] = []): Promise<any> {
        try {
            const config: any = {
                headers: { 'Content-Type': 'application/json' }
            };

            // Only add auth if user/pass are configured
            if (CONFIG.ZEC_RPC_USER && CONFIG.ZEC_RPC_PASS) {
                config.auth = {
                    username: CONFIG.ZEC_RPC_USER,
                    password: CONFIG.ZEC_RPC_PASS,
                };
            }

            const response = await axios.post(
                CONFIG.ZEC_RPC_URL,
                {
                    jsonrpc: '1.0',
                    id: 'zcash-bridge-oracle',
                    method,
                    params,
                },
                config
            );

            if (response.data.error) {
                throw new Error(`RPC Error: ${JSON.stringify(response.data.error)}`);
            }
            return response.data.result;
        } catch (error: any) {
            const msg = error.response ? JSON.stringify(error.response.data) : error.message;
            throw new Error(`RPC Call Failed: ${msg}`);
        }
    }

    async getBlockCount(): Promise<number> {
        return await this.call('getblockcount');
    }

    async getBlockHash(height: number): Promise<string> {
        return await this.call('getblockhash', [height]);
    }

    async getBlock(hash: string): Promise<ZcashBlock> {
        // verbosity 1 to get JSON object
        // Some RPCs might need verbosity 2 for full txs, but 1 is usually enough for header info
        return await this.call('getblock', [hash, 1]);
    }

    async getOrchardAnchor(height: number): Promise<string | null> {
        try {
            const hash = await this.getBlockHash(height);
            const block = await this.getBlock(hash);

            if (block.orchard_tree && block.orchard_tree.root) {
                return block.orchard_tree.root;
            }
            if (block.finalorchardroot) {
                return block.finalorchardroot;
            }
            return null;
        } catch (e) {
            console.error(`Failed to fetch anchor for height ${height}:`, e);
            return null;
        }
    }
}
