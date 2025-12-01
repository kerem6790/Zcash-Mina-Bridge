import { ZecBridge, IntentStruct, IntentState } from '../ZecBridge.js';
import { PrivateKey, Mina, AccountUpdate, fetchAccount, Field, UInt64, UInt32, MerkleMap, Poseidon, PublicKey } from 'o1js';
import { MINA_GRAPHQL_ENDPOINT, ZECBRIDGE_ADDRESS, MAKER_PUBLIC_KEY, DEPLOYER_PRIVATE_KEY } from '../config.js';
import * as fs from 'fs';

const NETWORK_URL = MINA_GRAPHQL_ENDPOINT;
const ZKAPP_ADDRESS = ZECBRIDGE_ADDRESS;
const MAKER_KEY = PrivateKey.fromBase58(DEPLOYER_PRIVATE_KEY); // Using deployer as maker for simplicity or separate key
const MAKER_ADDR = MAKER_KEY.toPublicKey();

async function main() {
    // Load or Init Merkle Map
    let mapData: any = {};
    if (fs.existsSync('merkle_map.json')) {
        mapData = JSON.parse(fs.readFileSync('merkle_map.json', 'utf8'));
    }
    const map = new MerkleMap();
    for (const [key, value] of Object.entries(mapData)) {
        map.set(Field(key), Field(value as string));
    }

    // Load or Init Intents Store
    let intentsData: any = {};
    if (fs.existsSync('intents.json')) {
        intentsData = JSON.parse(fs.readFileSync('intents.json', 'utf8'));
    }

    // Setup Mina
    const Network = Mina.Network(NETWORK_URL);
    Mina.setActiveInstance(Network);

    try {
        console.log('Compiling...');
        await ZecBridge.compile();
        const zkAppAddress = PublicKey.fromBase58(ZKAPP_ADDRESS);
        await fetchAccount({ publicKey: zkAppAddress });
        const { account } = await fetchAccount({ publicKey: MAKER_ADDR });
        const zkApp = new ZecBridge(zkAppAddress);

        // Fetch nextIntentId
        await fetchAccount({ publicKey: zkAppAddress });
        const nextId = zkApp.nextIntentId.get();
        console.log(`Next Intent ID: ${nextId.toString()} `);

        // Prepare Intent Data
        const amountMina = UInt64.from(1000000000); // 1 MINA
        const minZec = UInt64.from(100000); // 0.001 ZEC
        const recipient = Field(12345); // Mock Zcash Address Commitment
        const deadline = UInt32.from(2_000_000); // Far future slot (Devnet is around 734k)

        // 1. Create Intent
        console.log(`Next Intent ID: ${nextId.toString()}`);
        const witnessCreate = map.getWitness(nextId);

        console.log('Sending Create Intent Transaction...');
        const txCreate = await Mina.transaction({ sender: MAKER_ADDR, fee: 100_000_000 }, async () => {
            await zkApp.createIntent(amountMina, minZec, recipient, deadline, witnessCreate);
        });
        await txCreate.prove();
        const pendingCreate = await txCreate.sign([MAKER_KEY]).send();

        console.log(`Create Intent Tx Hash: ${pendingCreate.hash}`);
        console.log('Waiting for inclusion...');
        await pendingCreate.wait();
        console.log('Intent Created and Included!');

        // Update Local Map (PENDING_LOCK)
        const intent = new IntentStruct({
            intentId: nextId,
            makerAddress: MAKER_ADDR,
            makerAmountMina: amountMina,
            minZecZat: minZec,
            zcashRecipientCommitment: recipient,
            deadlineSlot: deadline,
            state: IntentState.PENDING_LOCK
        });
        map.set(nextId, intent.hash());

        // 2. Lock Mina
        console.log('Locking MINA...');
        const witnessLock = map.getWitness(nextId);

        const txLock = await Mina.transaction({ sender: MAKER_ADDR, fee: 500_000_000 }, async () => {
            await zkApp.lockMina(nextId, witnessLock, intent);
        });
        await txLock.prove();
        await txLock.sign([MAKER_KEY]).send();
        console.log('MINA Locked!');

        // Update Local Map (OPEN)
        const intentOpen = new IntentStruct({
            ...intent,
            state: IntentState.OPEN
        });
        map.set(nextId, intentOpen.hash());

        // Save Data
        mapData[nextId.toString()] = intentOpen.hash().toString();
        fs.writeFileSync('merkle_map.json', JSON.stringify(mapData, null, 2));

        intentsData[nextId.toString()] = {
            intentId: nextId.toString(),
            makerAddress: MAKER_ADDR.toBase58(),
            makerAmountMina: amountMina.toString(),
            minZecZat: minZec.toString(),
            zcashRecipientCommitment: recipient.toString(),
            deadlineSlot: deadline.toString(),
            state: 0 // OPEN
        };
        fs.writeFileSync('intents.json', JSON.stringify(intentsData, null, 2));

    } catch (error) {
        console.error(error);
    }
}

// Helper for fetchAccount if not imported
// import { fetchAccount } from 'o1js';

main();
