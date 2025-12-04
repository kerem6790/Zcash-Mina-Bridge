import {
    Field,
    Mina,
    PrivateKey,
    AccountUpdate,
    UInt64,
    UInt32,
    Poseidon,
    MerkleMap,
    PublicKey,
    Signature
} from 'o1js';
import { BridgeContract, IntentStruct } from './BridgeContract.js';
import { MinaBridgeExportV1 } from 'bridge-core';
import * as fs from 'fs';

async function main() {
    // 1. Setup Local Blockchain
    const Local = await Mina.LocalBlockchain({ proofsEnabled: false });
    Mina.setActiveInstance(Local);

    const deployerKey = Local.testAccounts[0].key;
    const deployerAddr = Local.testAccounts[0];

    const makerKey = Local.testAccounts[1].key;
    const makerAddr = Local.testAccounts[1];

    const zkAppKey = PrivateKey.random();
    const zkAppAddr = zkAppKey.toPublicKey();

    const zkApp = new BridgeContract(zkAppAddr);

    console.log('Deploying BridgeContract...');
    await BridgeContract.compile();

    let tx = await Mina.transaction(deployerAddr, async () => {
        AccountUpdate.fundNewAccount(deployerAddr);
        await zkApp.deploy({});
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

    // 4. Generate Oracle Signature
    console.log('Generating Oracle Signature...');
    const value = UInt64.from(60000); // > 50000
    const nf = Field.random();
    const bridgeNullifier = Poseidon.hash([nf, intentId]);

    // Oracle signs: [bridgeNullifier, claimedAmount, receiverHash]
    const oracleSignature = Signature.create(deployerKey, [
        bridgeNullifier,
        ...value.toFields(),
        receiverHash
    ]);

    // 5. Claim
    console.log('Claiming...');

    // Prepare inputs
    // const bridgeNullifier = Poseidon.hash([nf, intentId]); // Already defined
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
            bridgeNullifier,
            oracleSignature
        );
    });
    await tx.prove();
    await tx.sign([makerKey]).send();

    console.log('Claim Successful!');
}

main().catch(console.error);
