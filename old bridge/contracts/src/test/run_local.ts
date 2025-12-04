import { ZecBridge, IntentStruct, IntentState, ZcashTxData, ZcashOutput } from '../ZecBridge.js';
import { Mina, PrivateKey, AccountUpdate, Field, UInt64, UInt32, MerkleMap, Poseidon, Bool } from 'o1js';

async function main() {
    console.log('Starting Local Test...');
    const Local = await Mina.LocalBlockchain({ proofsEnabled: false });
    Mina.setActiveInstance(Local);

    const [deployerAccount, makerAccount, takerAccount] = Local.testAccounts;
    const deployerAddress = deployerAccount.key.toPublicKey();
    const makerAddress = makerAccount.key.toPublicKey();
    const takerAddress = takerAccount.key.toPublicKey();

    const zkAppPrivateKey = PrivateKey.random();
    const zkAppAddress = zkAppPrivateKey.toPublicKey();
    const zkApp = new ZecBridge(zkAppAddress);
    const merkleMap = new MerkleMap();

    console.log('Deploying...');
    const txn = await Mina.transaction(deployerAddress, async () => {
        AccountUpdate.fundNewAccount(deployerAddress);
        await zkApp.deploy();
    });
    await txn.prove();
    await txn.sign([deployerAccount.key, zkAppPrivateKey]).send();

    console.log('Deployed. Initial State:', zkApp.nextIntentId.get().toString());

    // Create Intent
    console.log('Creating Intent...');
    const amountMina = UInt64.from(10_000_000_000);
    const minZec = UInt64.from(100_000);
    const recipient = Field(12345);
    const deadline = UInt32.from(1000);
    const nextId = zkApp.nextIntentId.get();

    const witnessCreate = merkleMap.getWitness(nextId);

    const txCreate = await Mina.transaction(makerAddress, async () => {
        await zkApp.createIntent(amountMina, minZec, recipient, deadline, witnessCreate);
    });
    await txCreate.prove();
    await txCreate.sign([makerAccount.key]).send();

    // Update Local Map
    let intent = new IntentStruct({
        intentId: nextId,
        makerAddress: makerAddress,
        makerAmountMina: amountMina,
        minZecZat: minZec,
        zcashRecipientCommitment: recipient,
        deadlineSlot: deadline,
        state: IntentState.PENDING_LOCK
    });
    merkleMap.set(nextId, intent.hash());

    // Lock MINA
    console.log('Locking MINA...');
    const witnessLock = merkleMap.getWitness(nextId);
    const txLock = await Mina.transaction(makerAddress, async () => {
        await zkApp.lockMina(nextId, witnessLock, intent);
    });
    await txLock.prove();
    await txLock.sign([makerAccount.key]).send();

    intent = new IntentStruct({ ...intent, state: IntentState.OPEN });
    merkleMap.set(nextId, intent.hash());

    console.log('Intent Locked. State:', zkApp.intentsRoot.get().toString());

    // Claim
    console.log('Claiming...');
    const txid = Field(999999);
    const path: Field[] = [];
    let currentHash = txid;
    for (let i = 0; i < 32; i++) {
        const sibling = Field(0);
        path.push(sibling);
        currentHash = Poseidon.hash([currentHash, sibling]);
    }
    const merkleRoot = currentHash;
    const blockHeaderHash = merkleRoot;

    // Set Oracle
    const txOracle = await Mina.transaction(deployerAddress, async () => {
        await zkApp.setOracleBlockHeaderHash(blockHeaderHash);
    });
    await txOracle.prove();
    await txOracle.sign([deployerAccount.key]).send();

    const outputs = [
        new ZcashOutput({ recipientCommitment: recipient, amountZat: minZec.add(100) }),
        new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
        new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
        new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
        new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
    ];

    const zcashTxData = new ZcashTxData({
        blockHeaderHash,
        merkleRoot,
        txid,
        merklePath: path,
        merkleIndex: Field(0),
        outputs
    });

    const witnessClaim = merkleMap.getWitness(nextId);
    const txClaim = await Mina.transaction(takerAddress, async () => {
        await zkApp.claim(nextId, zcashTxData, witnessClaim, intent);
    });
    await txClaim.prove();
    await txClaim.sign([takerAccount.key]).send();

    // Update Local Map to FILLED
    intent = new IntentStruct({ ...intent, state: IntentState.FILLED });
    merkleMap.set(nextId, intent.hash());

    console.log('Claimed successfully!');
    const zkAppBalance = Mina.getBalance(zkAppAddress);
    console.log('zkApp Balance:', zkAppBalance.toString());
    if (zkAppBalance.equals(UInt64.from(0)).toBoolean()) {
        console.log('SUCCESS CASE PASSED');
    } else {
        console.log('SUCCESS CASE FAILED: Balance not 0');
    }

    // --- FAILURE CASES ---

    // 1. Invalid Recipient
    console.log('Testing Failure: Invalid Recipient...');
    try {
        const outputsBad = [
            new ZcashOutput({ recipientCommitment: Field(99999), amountZat: minZec.add(100) }), // Wrong recipient
            new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
            new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
            new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
            new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
        ];
        const zcashTxDataBad = new ZcashTxData({
            blockHeaderHash, merkleRoot, txid, merklePath: path, merkleIndex: Field(0), outputs: outputsBad
        });
        // We need a new intent or reset state? 
        // The previous intent is FILLED. We need a new one.
        // For simplicity, let's just try to claim the SAME intent again (should fail due to state FILLED)
        // But we want to test recipient check. So we need a NEW intent.

        // Create Intent 2
        const nextId2 = zkApp.nextIntentId.get();
        const witnessCreate2 = merkleMap.getWitness(nextId2);
        const txCreate2 = await Mina.transaction(makerAddress, async () => {
            await zkApp.createIntent(amountMina, minZec, recipient, deadline, witnessCreate2);
        });
        await txCreate2.prove();
        await txCreate2.sign([makerAccount.key]).send();

        const intent2 = new IntentStruct({
            intentId: nextId2, makerAddress, makerAmountMina: amountMina, minZecZat: minZec, zcashRecipientCommitment: recipient, deadlineSlot: deadline, state: IntentState.PENDING_LOCK
        });
        merkleMap.set(nextId2, intent2.hash());

        const witnessLock2 = merkleMap.getWitness(nextId2);
        const txLock2 = await Mina.transaction(makerAddress, async () => {
            await zkApp.lockMina(nextId2, witnessLock2, intent2);
        });
        await txLock2.prove();
        await txLock2.sign([makerAccount.key]).send();

        const intent2Open = new IntentStruct({ ...intent2, state: IntentState.OPEN });
        merkleMap.set(nextId2, intent2Open.hash());

        const witnessClaim2 = merkleMap.getWitness(nextId2);
        const txClaim2 = await Mina.transaction(takerAddress, async () => {
            await zkApp.claim(nextId2, zcashTxDataBad, witnessClaim2, intent2Open);
        });
        await txClaim2.prove();
        await txClaim2.sign([takerAccount.key]).send();
        console.log('FAILURE CASE FAILED: Should have thrown');
    } catch (e: any) {
        if (e.message.includes('No matching output found')) {
            console.log('FAILURE CASE PASSED: Invalid Recipient');
        } else {
            console.log('FAILURE CASE FAILED: Wrong error:', e.message);
        }
    }

    // 2. Insufficient Amount
    console.log('Testing Failure: Insufficient Amount...');
    try {
        const outputsLow = [
            new ZcashOutput({ recipientCommitment: recipient, amountZat: minZec.sub(1) }), // Low amount
            new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
            new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
            new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
            new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
        ];
        const zcashTxDataLow = new ZcashTxData({
            blockHeaderHash, merkleRoot, txid, merklePath: path, merkleIndex: Field(0), outputs: outputsLow
        });

        // Reuse Intent 2 (it's still OPEN because previous claim failed)
        // We need to re-fetch witness? No, map hasn't changed.
        const nextId2 = zkApp.nextIntentId.get().sub(1); // It was incremented
        const intent2Open = new IntentStruct({
            intentId: nextId2, makerAddress, makerAmountMina: amountMina, minZecZat: minZec, zcashRecipientCommitment: recipient, deadlineSlot: deadline, state: IntentState.OPEN
        });
        const witnessClaim2 = merkleMap.getWitness(nextId2);

        const txClaim3 = await Mina.transaction(takerAddress, async () => {
            await zkApp.claim(nextId2, zcashTxDataLow, witnessClaim2, intent2Open);
        });
        await txClaim3.prove();
        await txClaim3.sign([takerAccount.key]).send();
        console.log('FAILURE CASE FAILED: Should have thrown');
    } catch (e: any) {
        if (e.message.includes('No matching output found')) {
            console.log('FAILURE CASE PASSED: Insufficient Amount');
        } else {
            console.log('FAILURE CASE FAILED: Wrong error:', e.message);
        }
    }

    // 3. Wrong Merkle Root
    console.log('Testing Failure: Wrong Merkle Root...');
    try {
        const zcashTxDataBadRoot = new ZcashTxData({
            blockHeaderHash,
            merkleRoot: Field(123), // Wrong root
            txid, merklePath: path, merkleIndex: Field(0), outputs: outputs
        });

        const nextId2 = zkApp.nextIntentId.get().sub(1);
        const intent2Open = new IntentStruct({
            intentId: nextId2, makerAddress, makerAmountMina: amountMina, minZecZat: minZec, zcashRecipientCommitment: recipient, deadlineSlot: deadline, state: IntentState.OPEN
        });
        const witnessClaim2 = merkleMap.getWitness(nextId2);

        const txClaim4 = await Mina.transaction(takerAddress, async () => {
            await zkApp.claim(nextId2, zcashTxDataBadRoot, witnessClaim2, intent2Open);
        });
        await txClaim4.prove();
        await txClaim4.sign([takerAccount.key]).send();
        console.log('FAILURE CASE FAILED: Should have thrown');
    } catch (e: any) {
        // Error message might vary depending on assertion
        console.log('FAILURE CASE PASSED: Wrong Merkle Root (Error caught)');
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
