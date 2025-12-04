import {
    Field,
    Mina,
    PrivateKey,
    AccountUpdate,
    UInt64,
    UInt32,
    Poseidon,
    MerkleMap,
    PublicKey
} from 'o1js';
import { BridgeContract, IntentStruct, MerklePath32 } from './BridgeContract.js';
import { MinaBridgeExportV1 } from 'bridge-core';
import * as fs from 'fs';

async function main() {
    // 1. Setup Local Blockchain
    const Local = Mina.LocalBlockchain({ proofsEnabled: false });
    Mina.setActiveInstance(Local);

    const deployerKey = Local.testAccounts[0].privateKey;
    const deployerAddr = deployerKey.toPublicKey();

    const makerKey = Local.testAccounts[1].privateKey;
    const makerAddr = makerKey.toPublicKey();

    const zkAppKey = PrivateKey.random();
    const zkAppAddr = zkAppKey.toPublicKey();

    const zkApp = new BridgeContract(zkAppAddr);

    console.log('Deploying BridgeContract...');
    await BridgeContract.compile();

    let tx = await Mina.transaction(deployerAddr, async () => {
        AccountUpdate.fundNewAccount(deployerAddr);
        await zkApp.deploy();
        await zkApp.initialize(deployerAddr);
    });
    await tx.prove();
    await tx.sign([deployerKey, zkAppKey]).send();

    // 2. Create Intent
    console.log('Creating Intent...');
    const intentId = Field(0);
    const amountToLock = UInt64.from(1000);
    const minZecAmount = UInt64.from(50000); // 0.0005 ZEC
    const deadlineSlot = UInt32.from(1000);

    // Mock Zcash Receiver
    const pk_d_receiver = Field.random();
    const receiverHash = Poseidon.hash([pk_d_receiver]);

    // Merkle Map for Intents
    const intentsMap = new MerkleMap();
    const keyWitness = intentsMap.getWitness(intentId);

    tx = await Mina.transaction(makerAddr, async () => {
        await zkApp.createIntent(
            minZecAmount,
            receiverHash,
            deadlineSlot,
            amountToLock,
            keyWitness
        );
    });
    await tx.prove();
    await tx.sign([makerKey]).send();

    // Update local map
    const intent = new IntentStruct({
        minaMaker: makerAddr,
        lockedAmountMina: amountToLock,
        minZecAmount: minZecAmount,
        receiverHash: receiverHash,
        deadlineSlot: deadlineSlot,
        state: Field(0),
    });
    intentsMap.set(intentId, Poseidon.hash(IntentStruct.toFields(intent)));

    // 3. Generate Mock Proof
    console.log('Generating Mock Proof...');
    const value = UInt64.from(60000); // > 50000
    const rseed = Field.random();
    const rho = Field.random();
    const nf = Field.random();
    const position = Field(0);

    // Compute Commitment
    const cm = Poseidon.hash([pk_d_receiver, value.value, rseed, rho]);

    // Generate Merkle Path
    const pathElements: Field[] = [];
    for (let i = 0; i < 32; i++) {
        pathElements.push(Field.random());
    }
    const merklePath = new MerklePath32({ path: pathElements });

    // Compute Anchor (Root)
    let currentHash = cm;
    const pathBits = position.toBits(32);
    for (let i = 0; i < 32; i++) {
        const sibling = pathElements[i];
        const isRight = pathBits[i];
        currentHash = isRight ? Poseidon.hash([sibling, currentHash]) : Poseidon.hash([currentHash, sibling]);
    }
    const anchor = currentHash;

    // Save Mock JSON
    const mockJson: MinaBridgeExportV1 = {
        version: 1,
        network: "testnet",
        txid: "mock_txid",
        orchard: {
            pk_d_receiver: pk_d_receiver.toString(), // Note: In real app this is hex, here we use string of Field for simplicity in this script, but prover expects hex usually. 
            // Wait, prover.ts uses hexToField. So we should store hex.
            // But Field.toString() returns decimal string.
            // Let's use BigInt(field).toString(16)
            value: value.toString(),
            rseed: BigInt(rseed.toString()).toString(16),
            rho: BigInt(rho.toString()).toString(16),
            cm: BigInt(cm.toString()).toString(16),
            anchor: BigInt(anchor.toString()).toString(16),
            merklePath: pathElements.map(f => BigInt(f.toString()).toString(16)),
            position: Number(position.toString()),
            nf: BigInt(nf.toString()).toString(16),
            pk_d_receiver: BigInt(pk_d_receiver.toString()).toString(16)
        }
    };

    fs.writeFileSync('mock_proof.json', JSON.stringify(mockJson, null, 2));
    console.log('Saved mock_proof.json');

    // 4. Update Oracle Anchor
    console.log('Updating Oracle Anchor...');
    tx = await Mina.transaction(deployerAddr, async () => {
        await zkApp.adminUpdateAnchor(anchor);
    });
    await tx.prove();
    await tx.sign([deployerKey]).send();

    // 5. Claim
    console.log('Claiming...');

    // Prepare inputs
    const bridgeNullifier = Poseidon.hash([nf, intentId]);
    const nullifiersMap = new MerkleMap();
    const nullifierWitness = nullifiersMap.getWitness(bridgeNullifier);

    // Re-get intent witness (root changed?)
    // Yes, createIntent updated the root.
    // We updated our local map, so we can get a fresh witness.
    const claimKeyWitness = intentsMap.getWitness(intentId);

    tx = await Mina.transaction(makerAddr, async () => {
        await zkApp.claim(
            intentId,
            intent,
            claimKeyWitness,
            nullifierWitness,
            value, // claimedAmount
            receiverHash,
            anchor,
            bridgeNullifier,
            cm,
            pk_d_receiver,
            value,
            rseed,
            rho,
            merklePath,
            position,
            nf
        );
    });
    await tx.prove();
    await tx.sign([makerKey]).send();

    console.log('Claim Successful!');
}

main().catch(console.error);
