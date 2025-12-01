import { ZecBridge, IntentStruct, IntentState, ZcashTxData, ZcashOutput } from '../ZecBridge';
import { Mina, PrivateKey, AccountUpdate, Field, UInt64, UInt32, MerkleMap, Poseidon, Bool } from 'o1js';

let proofsEnabled = false;

describe('ZecBridge Local Test', () => {
    let deployerAccount: PrivateKey,
        deployerAddress: any,
        makerAccount: PrivateKey,
        makerAddress: any,
        takerAccount: PrivateKey,
        takerAddress: any,
        zkAppAddress: any,
        zkAppPrivateKey: PrivateKey,
        zkApp: ZecBridge,
        merkleMap: MerkleMap;


    beforeAll(async () => {
        if (proofsEnabled) await ZecBridge.compile();
    });

    beforeEach(async () => {
        const Local = await Mina.LocalBlockchain({ proofsEnabled });
        Mina.setActiveInstance(Local);

        // Local.testAccounts returns an array of { publicKey, privateKey } objects, not just PrivateKey
        // We need to extract the private keys.
        const accounts = Local.testAccounts;
        deployerAccount = accounts[0].key;
        makerAccount = accounts[1].key;
        takerAccount = accounts[2].key;
        deployerAddress = deployerAccount.toPublicKey();
        makerAddress = makerAccount.toPublicKey();
        takerAddress = takerAccount.toPublicKey();

        zkAppPrivateKey = PrivateKey.random();
        zkAppAddress = zkAppPrivateKey.toPublicKey();
        zkApp = new ZecBridge(zkAppAddress);
        merkleMap = new MerkleMap();
    });

    async function deploy() {
        const txn = await Mina.transaction(deployerAddress, async () => {
            AccountUpdate.fundNewAccount(deployerAddress);
            await zkApp.deploy();
        });
        await txn.prove();
        await txn.sign([deployerAccount, zkAppPrivateKey]).send();
    }

    it('generates and deploys the `ZecBridge` smart contract', async () => {
        await deploy();
        const nextId = zkApp.nextIntentId.get();
        expect(nextId).toEqual(Field(0));
    });

    it('correctly creates an intent and locks MINA', async () => {
        await deploy();

        const amountMina = UInt64.from(10_000_000_000); // 10 MINA
        const minZec = UInt64.from(100_000); // 0.001 ZEC
        const recipient = Field(12345);
        const deadline = UInt32.from(1000);

        // Create Intent
        const nextId = zkApp.nextIntentId.get();
        const witnessCreate = merkleMap.getWitness(nextId);

        const txCreate = await Mina.transaction(makerAddress, async () => {
            await zkApp.createIntent(amountMina, minZec, recipient, deadline, witnessCreate);
        });
        await txCreate.prove();
        await txCreate.sign([makerAccount]).send();

        // Update Local Map
        const intent = new IntentStruct({
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
        const witnessLock = merkleMap.getWitness(nextId);
        const txLock = await Mina.transaction(makerAddress, async () => {
            await zkApp.lockMina(nextId, witnessLock, intent);
        });
        await txLock.prove();
        await txLock.sign([makerAccount]).send();

        // Update Local Map
        const intentOpen = new IntentStruct({
            ...intent,
            state: IntentState.OPEN
        });
        merkleMap.set(nextId, intentOpen.hash());

        // Verify State
        const root = zkApp.intentsRoot.get();
        expect(root).toEqual(merkleMap.getRoot());

        // Check zkApp Balance
        const balance = Mina.getBalance(zkAppAddress);
        expect(balance).toEqual(amountMina);
    });

    it('successfully claims an intent with valid Zcash proof', async () => {
        await deploy();

        // Setup Intent
        const amountMina = UInt64.from(10_000_000_000);
        const minZec = UInt64.from(100_000);
        const recipient = Field(12345);
        const deadline = UInt32.from(1000);
        const intentId = Field(0);

        // Create & Lock
        const witnessCreate = merkleMap.getWitness(intentId);
        await (await Mina.transaction(makerAddress, async () => {
            await zkApp.createIntent(amountMina, minZec, recipient, deadline, witnessCreate);
        })).sign([makerAccount]).send();

        let intent = new IntentStruct({
            intentId, makerAddress, makerAmountMina: amountMina, minZecZat: minZec, zcashRecipientCommitment: recipient, deadlineSlot: deadline, state: IntentState.PENDING_LOCK
        });
        merkleMap.set(intentId, intent.hash());

        const witnessLock = merkleMap.getWitness(intentId);
        await (await Mina.transaction(makerAddress, async () => {
            await zkApp.lockMina(intentId, witnessLock, intent);
        })).sign([makerAccount]).send();

        intent = new IntentStruct({ ...intent, state: IntentState.OPEN });
        merkleMap.set(intentId, intent.hash());

        // Prepare Mock Zcash Data
        const txid = Field(999999);
        // Path: hash(txid, sibling1) -> hash(res, sibling2) ...
        // We need 32 levels.
        // Let's make a simple path where all siblings are 0
        const path: Field[] = [];
        let currentHash = txid;
        for (let i = 0; i < 32; i++) {
            const sibling = Field(0);
            path.push(sibling);
            currentHash = Poseidon.hash([currentHash, sibling]);
        }
        const merkleRoot = currentHash;
        const blockHeaderHash = merkleRoot; // For PoC we assume header hash IS the root

        // Set Oracle
        await (await Mina.transaction(deployerAddress, async () => {
            await zkApp.setOracleBlockHeaderHash(blockHeaderHash);
        })).sign([deployerAccount]).send();

        // Prepare Witness Data
        const outputs = [
            new ZcashOutput({ recipientCommitment: recipient, amountZat: minZec.add(100) }), // Valid output
            new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
            new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
            new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
            new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
        ];

        const zcashTxData = new ZcashTxData({
            blockHeaderHash, merkleRoot, txid, merklePath: path, merkleIndex: Field(0), outputs
        });

        // Claim
        const witnessClaim = merkleMap.getWitness(intentId);
        const txClaim = await Mina.transaction(takerAddress, async () => {
            await zkApp.claim(intentId, zcashTxData, witnessClaim, intent);
        });
        await txClaim.prove();
        await txClaim.sign([takerAccount]).send();

        // Verify Result
        const takerBalance = Mina.getBalance(takerAddress);
        // Taker started with 1000 MINA (default local). Should have +10 MINA - fee?
        // LocalBlockchain accounts usually start with huge balance.
        // We can check zkApp balance is 0.
        const zkAppBalance = Mina.getBalance(zkAppAddress);
        expect(zkAppBalance).toEqual(UInt64.from(0));
    });

    it('fails to claim with invalid recipient', async () => {
        await deploy();
        // ... Setup Intent (Same as above) ...
        const amountMina = UInt64.from(10_000_000_000);
        const minZec = UInt64.from(100_000);
        const recipient = Field(12345);
        const deadline = UInt32.from(1000);
        const intentId = Field(0);

        const witnessCreate = merkleMap.getWitness(intentId);
        await (await Mina.transaction(makerAddress, async () => {
            await zkApp.createIntent(amountMina, minZec, recipient, deadline, witnessCreate);
        })).sign([makerAccount]).send();

        let intent = new IntentStruct({
            intentId, makerAddress, makerAmountMina: amountMina, minZecZat: minZec, zcashRecipientCommitment: recipient, deadlineSlot: deadline, state: IntentState.PENDING_LOCK
        });
        merkleMap.set(intentId, intent.hash());

        const witnessLock = merkleMap.getWitness(intentId);
        await (await Mina.transaction(makerAddress, async () => {
            await zkApp.lockMina(intentId, witnessLock, intent);
        })).sign([makerAccount]).send();

        intent = new IntentStruct({ ...intent, state: IntentState.OPEN });
        merkleMap.set(intentId, intent.hash());

        // Mock Zcash Data
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

        await (await Mina.transaction(deployerAddress, async () => {
            await zkApp.setOracleBlockHeaderHash(blockHeaderHash);
        })).sign([deployerAccount]).send();

        // Invalid Output (Wrong Recipient)
        const outputs = [
            new ZcashOutput({ recipientCommitment: Field(99999), amountZat: minZec.add(100) }),
            new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
            new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
            new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
            new ZcashOutput({ recipientCommitment: Field(0), amountZat: UInt64.from(0) }),
        ];

        const zcashTxData = new ZcashTxData({
            blockHeaderHash, merkleRoot, txid, merklePath: path, merkleIndex: Field(0), outputs
        });

        const witnessClaim = merkleMap.getWitness(intentId);

        // Expect failure
        await expect(async () => {
            await Mina.transaction(takerAddress, async () => {
                await zkApp.claim(intentId, zcashTxData, witnessClaim, intent);
            });
        }).rejects.toThrow("No matching output found");
    });
});
