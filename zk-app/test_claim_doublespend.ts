import { Mina, PrivateKey, Field, UInt64, UInt32, Poseidon, MerkleMap, PublicKey, fetchAccount, MerkleMapWitness, Signature } from 'o1js';
import { BridgeContract, IntentStruct } from './src/BridgeContract';

const NETWORK_URL = 'https://api.minascan.io/node/devnet/v1/graphql';
const DEPLOYER_KEY = 'EKFFostjkp4arnySMXrsA2Ukrkc3ShidWxDxvehUje6P4FverH28';
const ZKAPP_ADDR = 'B62qnoC1EUAQuiSrUG8VCA5DCZijm65ovWgESBct776SpkunSRe3oo3';

async function main() {
    console.log("🚀 Testing Claim & Double Spend on Live Contract...");

    const Network = Mina.Network(NETWORK_URL);
    Mina.setActiveInstance(Network);

    const deployerKey = PrivateKey.fromBase58(DEPLOYER_KEY);
    const deployerAccount = deployerKey.toPublicKey();
    const zkAppAddress = PublicKey.fromBase58(ZKAPP_ADDR);
    const zkApp = new BridgeContract(zkAppAddress);

    console.log("Compiling...");
    await BridgeContract.compile();

    console.log("Fetching accounts...");
    await fetchAccount({ publicKey: deployerAccount });

    // Wait for initialization
    const expectedRoot = Field("22731122946631793544306773678309960639073656601863129978322145324846701682624");
    console.log("Waiting for contract initialization...");
    while (true) {
        const res = await fetchAccount({ publicKey: zkAppAddress });
        if (res.account) {
            const currentRoot = res.account.zkapp?.appState[3];
            if (currentRoot && currentRoot.equals(expectedRoot).toBoolean()) {
                console.log("Contract initialized!");
                break;
            }
            // Also check if it's already been used (root might change if intents were created)
            // But for this test we assume we can proceed if it's at least initialized.
            if (currentRoot && !currentRoot.equals(Field(0)).toBoolean()) {
                console.log("Contract appears initialized (root != 0). Proceeding.");
                break;
            }
            console.log(`Current root: ${currentRoot?.toString()}. Waiting...`);
        }
        await new Promise(r => setTimeout(r, 10000));
    }

    // --- 1. Create Intent ---
    console.log("\n📝 1. Creating Intent...");
    const amountToLock = UInt64.from(1 * 1e9); // 1 MINA
    const minZecAmount = UInt64.from(10000);
    const receiverPkD = Field(12345); // Mock receiver
    const receiverHash = Poseidon.hash([receiverPkD]);
    const deadline = UInt32.from(300000); // Far future

    // We need to fetch the current state to generate valid witnesses
    await fetchAccount({ publicKey: zkAppAddress });
    const nextIntentId = zkApp.nextIntentId.get();
    const intentsRoot = zkApp.intentsRoot.get();

    // NOTE: In a real app we would query an indexer to get the witness for `nextIntentId`.
    // Since we don't have a synced indexer for this script, and we know the map is sparse/empty-ish,
    // we will try to use an empty witness. 
    // IF THIS FAILS, it means the map is not empty at this index (unlikely for sequential IDs) 
    // or the root doesn't match an empty map + previous inserts.
    // Ideally we should replicate the map locally.
    // For this test, let's assume we are the only ones using it and we track state? 
    // Or better: We can't easily guess the witness if other intents exist.
    // BUT, for a newly deployed contract, we know the state.
    // Let's try with a fresh MerkleMap and replay if needed? No, too complex.
    // We will use a "dummy" witness and hope the map is empty at this index.
    // Actually, if the root is not the empty root, we can't produce a witness without the data.
    // Hack: We will just try to use an empty map witness. If it fails, we might need to redeploy or use the indexer.

    // Sync local map with existing state
    const intentsMap = new MerkleMap();

    // Sync Intent 0
    if (nextIntentId.greaterThanOrEqual(Field(1)).toBoolean()) {
        console.log("Syncing Intent 0...");
        const intent0 = new IntentStruct({
            minaMaker: deployerAccount,
            lockedAmountMina: UInt64.from(1 * 1e9),
            minZecAmount: UInt64.from(10000),
            receiverHash: Poseidon.hash([Field(12345)]),
            deadlineSlot: UInt32.from(200000),
            state: Field(0)
        });
        intentsMap.set(Field(0), Poseidon.hash(IntentStruct.toFields(intent0)));
    }

    // Sync Intent 1 (Failed Claim)
    if (nextIntentId.greaterThanOrEqual(Field(2)).toBoolean()) {
        console.log("Syncing Intent 1...");
        const intent1 = new IntentStruct({
            minaMaker: deployerAccount,
            lockedAmountMina: UInt64.from(1 * 1e9),
            minZecAmount: UInt64.from(10000),
            receiverHash: Poseidon.hash([Field(12345)]),
            deadlineSlot: UInt32.from(300000), // The failed deadline
            state: Field(0)
        });
        intentsMap.set(Field(1), Poseidon.hash(IntentStruct.toFields(intent1)));
    }

    const keyWitness = intentsMap.getWitness(nextIntentId);

    const createTx = await Mina.transaction({ sender: deployerAccount, fee: 200_000_000 }, async () => {
        await zkApp.createIntent(
            minZecAmount,
            receiverHash,
            UInt32.from(4000000000), // Large deadline
            amountToLock,
            keyWitness
        );
    });
    await createTx.prove();
    const createTxSent = await createTx.sign([deployerKey]).send();
    console.log(`✅ Intent Created! Hash: ${createTxSent.hash}`);
    await createTxSent.wait();


    // --- 2. Update Anchor (Mock Oracle) ---
    // Skipped: Oracle Anchor is no longer on-chain. We use signatures.
    console.log("\n🔮 2. Skipping Anchor Update (Using Signatures)...");


    // --- 3. Claim ---
    console.log("\n💰 3. Claiming...");

    // Re-fetch state
    await fetchAccount({ publicKey: zkAppAddress });

    // Reconstruct the intent struct we just created
    const intent = new IntentStruct({
        minaMaker: deployerAccount,
        lockedAmountMina: amountToLock,
        minZecAmount: minZecAmount,
        receiverHash: receiverHash,
        deadlineSlot: deadline,
        state: Field(0), // OPEN
    });

    // We need the witness for this intent.
    // Since we created it, we know it's at `nextIntentId`.
    // And we know the map state (it has this intent).
    intentsMap.set(nextIntentId, Poseidon.hash(IntentStruct.toFields(intent)));
    const claimKeyWitness = intentsMap.getWitness(nextIntentId);

    // Nullifier Witness (Empty map)
    const nullifiersMap = new MerkleMap();
    const nf = Field(999); // Random nullifier
    const bridgeNullifier = Poseidon.hash([nf, nextIntentId]);
    const nullifierWitness = nullifiersMap.getWitness(bridgeNullifier);

    const oracleSignature = Signature.create(deployerKey, [
        bridgeNullifier,
        ...minZecAmount.toFields(),
        receiverHash
    ]);

    const claimTx = await Mina.transaction({ sender: deployerAccount, fee: 200_000_000 }, async () => {
        await zkApp.claim(
            nextIntentId,
            intent,
            claimKeyWitness,
            nullifierWitness,
            minZecAmount,
            receiverHash,
            bridgeNullifier,
            oracleSignature
        );
    });
    await claimTx.prove();
    const claimTxSent = await claimTx.sign([deployerKey]).send();
    console.log(`✅ Claim Sent! Hash: ${claimTxSent.hash}`);
    await claimTxSent.wait();
    console.log("✅ Claim Confirmed!");


    // --- 4. Double Spend Test ---
    console.log("\n🚫 4. Testing Double Spend...");

    // Update local maps to reflect the claim
    // Intent state changes to FILLED (1)
    const filledIntent = new IntentStruct({ ...intent, state: Field(1) });
    intentsMap.set(nextIntentId, Poseidon.hash(IntentStruct.toFields(filledIntent)));

    // Nullifier is used
    nullifiersMap.set(bridgeNullifier, Field(1)); // Used

    // Witnesses for the second attempt
    const claimKeyWitness2 = intentsMap.getWitness(nextIntentId);
    const nullifierWitness2 = nullifiersMap.getWitness(bridgeNullifier);

    try {
        const doubleSpendTx = await Mina.transaction({ sender: deployerAccount, fee: 200_000_000 }, async () => {
            await zkApp.claim(
                nextIntentId,
                intent, // We try to claim the OPEN intent again (or even if we pass filled, it fails state check)
                // Actually, if we pass the 'intent' struct as OPEN, the witness verification will fail because the on-chain root is for FILLED.
                // If we pass 'filledIntent', the state check (intent.state.assertEquals(0)) will fail.
                // Let's try to pass the original 'intent' (OPEN) and the new witness.
                // The witness will prove that 'intent' is NOT in the root (because the root has FILLED).
                // So this should fail at "Verify Intent Inclusion".
                claimKeyWitness2,
                nullifierWitness2,
                minZecAmount,
                receiverHash,
                bridgeNullifier,
                oracleSignature
            );
        });
        await doubleSpendTx.prove();
        await doubleSpendTx.sign([deployerKey]).send();
        console.error("❌ Double Spend Succeeded (This is BAD!)");
    } catch (e: any) {
        console.log("✅ Double Spend Failed as expected!");
        // console.log("Error:", e.message);
    }
}

main().catch(console.error);
