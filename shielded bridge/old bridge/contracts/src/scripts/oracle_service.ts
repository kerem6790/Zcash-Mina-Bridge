import { ZecBridge } from '../ZecBridge.js';
import { ZcashRpcClient, MerkleTreeUtils } from './zcash_utils.js';
import { PrivateKey, Mina, AccountUpdate, Field, PublicKey, fetchAccount } from 'o1js';
import { MINA_GRAPHQL_ENDPOINT, ZECBRIDGE_ADDRESS, ORACLE_PRIVATE_KEY, ZCASH_RPC_URL, ZCASH_RPC_USER, ZCASH_RPC_PASS } from '../config.js';

// Configuration
const NETWORK_URL = MINA_GRAPHQL_ENDPOINT;
const ZKAPP_ADDRESS = ZECBRIDGE_ADDRESS;
const ORACLE_KEY = PrivateKey.fromBase58(ORACLE_PRIVATE_KEY); // Oracle key
const ORACLE_ADDR = ORACLE_KEY.toPublicKey();

async function main() {
    // Setup Mina
    const Network = Mina.Network(NETWORK_URL);
    Mina.setActiveInstance(Network);

    const zcash = new ZcashRpcClient(ZCASH_RPC_URL, ZCASH_RPC_USER, ZCASH_RPC_PASS);

    try {
        console.log('Fetching Zcash Block...');

        let block: any;
        let blockHash = '';
        let txids: string[] = [];

        try {
            // 1. Fetch Zcash Block Header
            const args = process.argv.slice(2);
            if (args.length > 0) {
                blockHash = args[0];
                console.log(`Using provided block hash: ${blockHash}`);
            } else {
                blockHash = await zcash.getBestBlockHash();
                console.log(`Using latest block hash: ${blockHash}`);
            }

            block = await zcash.getBlock(blockHash);
            txids = block.tx;
            console.log(`Zcash Tip: ${blockHash}`);
        } catch (e: any) {
            console.error("Could not connect to Zcash Node or fetch block:", e.message);
            process.exit(1);
        }

        // Compute Shadow Merkle Root (Poseidon)
        // The Oracle MUST set the root that the Bridge Service will prove against.
        // Since we are using "Shadow Tree", the Oracle must also compute this Shadow Root
        // and set it as the "blockHeaderHash" (or we assume blockHeaderHash IS the root).
        // As discussed, for PoC we assume oracleBlockHeaderHash        // 2. Compute "Shadow" Merkle Tree
        const { root } = MerkleTreeUtils.computePoseidonMerkleTree(txids);
        console.log(`Computed Shadow Merkle Root: ${root.toString()}`);

        // 3. Update Oracle
        console.log('Compiling ZecBridge...');
        await ZecBridge.compile();

        const zkAppAddress = PublicKey.fromBase58(ZECBRIDGE_ADDRESS);
        await fetchAccount({ publicKey: zkAppAddress });
        await fetchAccount({ publicKey: ORACLE_ADDR });

        const zkApp = new ZecBridge(zkAppAddress);

        console.log('Sending Transaction to update Oracle...');

        // Prepare prevHash
        // We need to convert previousblockhash (hex) to Field
        // Similar truncation as txid? Yes, for PoC.
        const prevHashHex = block.previousblockhash;
        const prevHash = Field(BigInt('0x' + prevHashHex.substring(0, 62)));

        const tx = await Mina.transaction({ sender: ORACLE_ADDR, fee: 100_000_000 }, async () => {
            await zkApp.setOracleBlockHeaderHash(root, prevHash);
        });

        await tx.prove();
        const pendingTx = await tx.sign([ORACLE_KEY]).send();
        console.log(`Oracle Update Tx Hash: ${pendingTx.hash}`);
        console.log('Waiting for inclusion...');
        await pendingTx.wait();
        console.log('Oracle Updated Successfully!');

    } catch (error) {
        console.error(error);
    }
}

main().catch((error) => {
    console.error('CRITICAL ERROR:', error);
    if (typeof error === 'object') {
        console.error(JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    }
    process.exit(1);
});
