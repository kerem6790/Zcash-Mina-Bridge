import axios from 'axios';
import { Field, Poseidon } from 'o1js';

export class ZcashRpcClient {
    private rpcUrl: string;
    private auth: any;

    constructor(url: string, user?: string, pass?: string) {
        this.rpcUrl = url;
        if (user && pass) {
            this.auth = { username: user, password: pass };
        }
    }

    async rpc(method: string, params: any[] = []) {
        try {
            const config: any = {
                headers: { 'Content-Type': 'application/json' },
            };
            if (this.auth) {
                config.auth = this.auth;
            }

            // DEBUG: Log config to see if auth is being sent
            // console.log('RPC Config:', JSON.stringify(config, null, 2));

            const response = await axios.post(
                this.rpcUrl,
                {
                    jsonrpc: '1.0',
                    id: 'curltest',
                    method,
                    params,
                },
                config
            );
            return response.data.result;
        } catch (error: any) {
            console.error(`RPC Error: ${method}`, error.message);
            throw error;
        }
    }

    async getBestBlockHash(): Promise<string> {
        return this.rpc('getbestblockhash', []);
    }

    async getBlock(blockHash: string): Promise<any> {
        return this.rpc('getblock', [blockHash, 2]); // Verbosity 2 for full tx details
    }

    async getRawTransaction(txid: string): Promise<any> {
        return this.rpc('getrawtransaction', [txid, 1]); // Verbosity 1 for JSON
    }
}

export class MerkleTreeUtils {
    // Compute a "Shadow" Merkle Tree using Poseidon to be compatible with o1js circuit
    static computePoseidonMerkleTree(txids: string[]): { root: Field; leaves: Field[] } {
        // Convert txids (hex strings) to Fields
        // We assume txid is 32 bytes. Field is ~254 bits.
        // We can't fit 32 bytes (256 bits) into one Field safely if it's fully random.
        // For PoC, we might split it or just take the first 31 bytes?
        // Or use 2 Fields per txid?
        // The circuit expects `txid: Field`.
        // User prompt: "txid: Field".
        // So we MUST fit it in one Field.
        // We will truncate or hash the txid string to a Field.
        const leaves = txids.map((tx: any) => {
            // Handle both string txids and full tx objects
            const txid = typeof tx === 'string' ? tx : tx.txid;

            // Convert hex txid to Field
            // txid is 32 bytes (64 hex chars). Field is ~254 bits.
            // We can't fit 256 bits into 254 bits.
            // For PoC, we'll take the first 31 bytes (62 hex chars) to fit safely.
            // In production, we'd split into 2 Fields.
            const truncatedHex = txid.substring(0, 62);
            return Field(BigInt('0x' + truncatedHex));
        });

        // Pad to power of 2?
        // Zcash trees are fixed depth?
        // For this "Shadow Tree", let's just build it up.
        // We need to match the circuit's `MerkleHelper.computeRoot` which does 32 steps.
        // So we need a tree of depth 32.
        // That's huge (2^32 leaves).
        // The circuit loop `for (let i = 0; i < 32; i++)` implies a path of length 32.
        // If the block has fewer txs, we pad with zeros?
        // Or maybe the circuit loop is just a max depth?
        // Let's assume we build a tree of the actual transactions, and the path is just the path to the root.
        // If the tree height is less than 32, we extend the path with zeros or self-hashes?
        // The circuit does `currentHash = Poseidon.hash([currentHash, path[i]])`.
        // This implies we consume 32 path elements.
        // So we must provide 32 elements.
        // We will build the tree, get the path, and pad the path with zeros if it's shorter than 32.
        // Wait, if we pad with zeros, the root changes.
        // We should pad the *tree* to depth 32? No, that's impossible.
        // We should probably just use the actual tree height and pad the *path* with identity elements that don't change the hash?
        // Poseidon(x, 0) != x.
        // So we can't just pad with 0.
        // The circuit forces 32 steps.
        // This means the circuit expects a tree of depth 32.
        // This is a constraint of the circuit I wrote based on the prompt.
        // For PoC, I will generate a path of length 32.
        // If the real tree is shorter, I'll just fill the rest with Field(0) and update the root accordingly?
        // No, the root is determined by the leaves.
        // Let's just build a standard Merkle Tree from the leaves.
        // Then, if the height < 32, we continue hashing with 0 (or some default) up to 32?
        // Yes, let's do that. "Sparse Merkle Tree" style or just "Deep Tree".

        // Compute root
        const root = MerkleTreeUtils.computeRootFromLeaves(leaves);
        return { root, leaves };
    }

    static getPath(leaves: Field[], index: number): Field[] {
        // Build tree and extract path
        // Simple recursive build
        let currentLevel = [...leaves];
        const path: Field[] = [];

        // We need exactly 32 levels for the circuit
        for (let level = 0; level < 32; level++) {
            if (currentLevel.length === 1) {
                // We reached the root of the data, but we need to go deeper to 32
                // We'll treat the current single node as the left child, and right child is 0?
                // Or just stop?
                // The circuit *always* hashes 32 times.
                // So we MUST provide 32 siblings.
                // If we are at root, what is the sibling?
                // Let's assume the tree is padded with 0s to 2^32? No.
                // Let's assume we just hash with 0 for the remaining levels.
                path.push(Field(0));
                currentLevel = [Poseidon.hash([currentLevel[0], Field(0)])];
                continue;
            }

            const nextLevel: Field[] = [];
            const isRight = index % 2 === 1;
            const siblingIndex = isRight ? index - 1 : index + 1;

            // If sibling exists, take it. If not (odd number of nodes), duplicate last or use 0?
            // Standard Merkle Tree usually duplicates last.
            const sibling = siblingIndex < currentLevel.length ? currentLevel[siblingIndex] : currentLevel[currentLevel.length - 1]; // Duplicate last if odd

            path.push(sibling);

            // Move to next level
            for (let i = 0; i < currentLevel.length; i += 2) {
                const left = currentLevel[i];
                const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left; // Duplicate
                nextLevel.push(Poseidon.hash([left, right]));
            }

            currentLevel = nextLevel;
            index = Math.floor(index / 2);
        }

        return path;
    }

    static computeRootFromLeaves(leaves: Field[]): Field {
        // Re-use logic or just get path for index 0 and compute?
        // Let's just simulate the process.
        let currentLevel = [...leaves];
        for (let level = 0; level < 32; level++) {
            if (currentLevel.length === 1) {
                currentLevel = [Poseidon.hash([currentLevel[0], Field(0)])];
                continue;
            }
            const nextLevel: Field[] = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                const left = currentLevel[i];
                const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
                nextLevel.push(Poseidon.hash([left, right]));
            }
            currentLevel = nextLevel;
        }
        return currentLevel[0];
    }
}
