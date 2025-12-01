import { ZecBridge, ZcashTxData, ZcashOutput, IntentStruct, IntentState } from '../ZecBridge.js';
import { ZcashRpcClient, MerkleTreeUtils } from './zcash_utils.js';
import { PrivateKey, Mina, AccountUpdate, Field, PublicKey, MerkleMap, UInt64, UInt32, Provable, fetchAccount, Poseidon } from 'o1js';
import * as fs from 'fs';
import { MINA_GRAPHQL_ENDPOINT, ZECBRIDGE_ADDRESS, DEPLOYER_PRIVATE_KEY, ZCASH_RPC_URL, ZCASH_RPC_USER, ZCASH_RPC_PASS } from '../config.js';

// Configuration
const NETWORK_URL = MINA_GRAPHQL_ENDPOINT;
const ZKAPP_ADDRESS = ZECBRIDGE_ADDRESS;
const TAKER_KEY = PrivateKey.fromBase58(DEPLOYER_PRIVATE_KEY); // Using deployer as taker for simplicity

async function main() {
    if (!ZKAPP_ADDRESS) {
        console.error('Please set ZKAPP_ADDRESS env variable');
        process.exit(1);
    }

    // Args: intentId, txid
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('Usage: node bridge_service.js <intentId> <txid>');
        process.exit(1);
    }
    const intentId = Field(args[0]);
    const txid = args[1];

    // Load keys (User2 / Taker)
    // For PoC, we use the same keys.json or a different one.
    if (!fs.existsSync('keys.json')) {
        console.error('keys.json not found.');
        process.exit(1);
    }
    const keyData = JSON.parse(fs.readFileSync('keys.json', 'utf8'));
    const takerKey = PrivateKey.fromBase58(keyData.privateKey);
    const takerAddr = takerKey.toPublicKey();

    // Load Merkle Map (Simulated Off-chain Storage)
    if (!fs.existsSync('merkle_map.json')) {
        console.error('merkle_map.json not found. No intents created?');
        process.exit(1);
    }
    const mapData = JSON.parse(fs.readFileSync('merkle_map.json', 'utf8'));
    const map = new MerkleMap();
    // Reconstruct map from serialized data (simplified: just assuming we saved leaves or re-insert)
    // Serialization of MerkleMap is not built-in. We usually save key-values.
    for (const [key, value] of Object.entries(mapData)) {
        map.set(Field(key), Field(value as string));
    }

    // Setup Mina
    const Network = Mina.Network(NETWORK_URL);
    Mina.setActiveInstance(Network);

    // Setup Zcash
    const zcash = new ZcashRpcClient(ZCASH_RPC_URL, ZCASH_RPC_USER, ZCASH_RPC_PASS);

    try {
        console.log(`Processing Claim for Intent ${args[0]} with Tx ${txid}...`);

        // 1. Fetch Zcash Data
        let txids: string[] = [];
        let blockHash = '';
        let rawTx: any = {};

        try {
            rawTx = await zcash.getRawTransaction(txid);
            blockHash = rawTx.blockhash;
            console.log(`Transaction Block Hash: ${blockHash}`);
            fs.writeFileSync('debug_log.txt', `Transaction Block Hash: ${blockHash}\n`);
            const block = await zcash.getBlock(blockHash);
            txids = block.tx;
        } catch (e: any) {
            console.error("Error fetching Zcash data:", e.message);
            process.exit(1);
        }

        // 2. Compute Merkle Path (Shadow Tree)
        const { leaves } = MerkleTreeUtils.computePoseidonMerkleTree(txids);
        // Find index of our txid
        // We need to hash our txid to Field to find it in leaves
        const truncatedHex = txid.substring(0, 62);
        const txidField = Field(BigInt('0x' + truncatedHex));

        let index = -1;
        for (let i = 0; i < leaves.length; i++) {
            if (leaves[i].equals(txidField).toBoolean()) {
                index = i;
                break;
            }
        }
        if (index === -1) {
            console.error("Txid not found in leaves (hash mismatch?)");
            process.exit(1);
        }

        const merklePath = MerkleTreeUtils.getPath(leaves, index);
        const merkleRoot = MerkleTreeUtils.computeRootFromLeaves(leaves);

        // 3. Construct ZcashTxData
        // Parse outputs
        const outputs = rawTx.vout.slice(0, 5).map((out: any) => {
            // Parse recipient from scriptPubKey (mock)
            // We assume recipientCommitment is passed as hex or we hash it
            // For PoC, let's use a dummy commitment that matches the intent
            // In real app, we parse scriptPubKey.
            // TODO: Implement real script parsing to extract recipient commitment
            return new ZcashOutput({
                recipientCommitment: Field(12345), // Mock: must match intent
                amountZat: UInt64.from(Math.floor(out.value * 100000000))
            });
        });

        // Pad outputs to 5
        while (outputs.length < 5) {
            outputs.push(new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }));
        }

        const zcashTxData = new ZcashTxData({
            blockHeaderHash: merkleRoot, // Assuming Oracle set this root
            merkleRoot: merkleRoot,
            txid: txidField,
            merklePath: merklePath,
            merkleIndex: Field(index),
            outputs: outputs
        });

        // DEBUG: Verify Merkle Root locally using Circuit Logic
        const indexBits = Field(index).toBits(32);
        let currentHash = txidField;
        for (let i = 0; i < 32; i++) {
            const isRight = indexBits[i].toBoolean();
            const sibling = merklePath[i];
            const left = isRight ? sibling : currentHash;
            const right = isRight ? currentHash : sibling;
            currentHash = Poseidon.hash([left, right]);
        }
        console.log(`Local Circuit Root: ${currentHash.toString()}`);
        console.log(`Merkle Root: ${merkleRoot.toString()}`);
        fs.appendFileSync('debug_log.txt', `Local Circuit Root: ${currentHash.toString()}\nMerkle Root: ${merkleRoot.toString()}\n`);
        if (!currentHash.equals(merkleRoot).toBoolean()) {
            console.error("CRITICAL: Local Circuit Root mismatch!");
            fs.appendFileSync('debug_log.txt', "CRITICAL: Local Circuit Root mismatch!\n");
        } else {
            console.log("Local Circuit Root matches Merkle Root.");
            fs.appendFileSync('debug_log.txt', "Local Circuit Root matches Merkle Root.\n");
        }

        // 4. Prepare Witness
        const witness = map.getWitness(intentId);

        // We need the IntentStruct to pass as well
        // We need to reconstruct it or fetch it.
        // For PoC, we will reconstruct it assuming we know the values (or fetch from mapData if we stored full struct)
        // This is tricky. The map only stores the hash.
        // We need a separate "Intent Store".
        // Let's assume `intents.json` stores the full structs.
        if (!fs.existsSync('intents.json')) {
            throw new Error("intents.json not found");
        }
        const intentsData = JSON.parse(fs.readFileSync('intents.json', 'utf8'));
        const intentData = intentsData[args[0]];
        if (!intentData) throw new Error("Intent data not found");

        const intent = new IntentStruct({
            intentId: Field(intentData.intentId),
            makerAddress: PublicKey.fromBase58(intentData.makerAddress),
            makerAmountMina: UInt64.from(intentData.makerAmountMina),
            minZecZat: UInt64.from(intentData.minZecZat),
            zcashRecipientCommitment: Field(intentData.zcashRecipientCommitment),
            deadlineSlot: UInt32.from(intentData.deadlineSlot),
            state: UInt32.from(intentData.state)
        });

        // 5. Call zkApp
        console.log('Compiling...');
        await ZecBridge.compile();
        const zkAppAddress = PublicKey.fromBase58(ZKAPP_ADDRESS);
        await fetchAccount({ publicKey: zkAppAddress });
        await fetchAccount({ publicKey: takerAddr });
        const zkApp = new ZecBridge(zkAppAddress);

        console.log('Sending Claim Transaction...');

        // DEBUG: Check Roots
        const currentRoot = zkApp.intentsRoot.get();
        console.log(`On-chain Root: ${currentRoot.toString()}`);
        console.log(`Local Map Root: ${map.getRoot().toString()}`);

        // DEBUG: Check Intent Hash
        const storedHash = map.get(intentId);
        console.log(`Stored Hash for Intent ${intentId}: ${storedHash.toString()}`);
        console.log(`Computed Intent Hash: ${intent.hash().toString()}`);

        const tx = await Mina.transaction({ sender: takerAddr, fee: 500_000_000 }, async () => {
            await zkApp.claim(intentId, zcashTxData, witness, intent);
        });

        await tx.prove();
        await tx.sign([takerKey]).send();

        console.log('Claim Successful!');

        // Update local map (Intent state changed to FILLED)
        const updatedIntent = new IntentStruct({
            ...intent,
            state: IntentState.FILLED
        });
        map.set(intentId, updatedIntent.hash());
        // Save map
        const mapObj: any = {};
        // map.forEach((v, k) => { mapObj[k.toString()] = v.toString() }); // MerkleMap doesn't have forEach?
        // We already updated mapData above with the single change.
        // mapData[args[0]] = updatedIntent.hash().toString(); // This was already done below.
        // Just ensure mapData is consistent.
        mapData[args[0]] = updatedIntent.hash().toString();
        fs.writeFileSync('merkle_map.json', JSON.stringify(mapData, null, 2));

        // Update intents.json
        intentData.state = 1; // FILLED
        intentsData[args[0]] = intentData;
        fs.writeFileSync('intents.json', JSON.stringify(intentsData, null, 2));

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
