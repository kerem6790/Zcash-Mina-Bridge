import {
    Field,
    SmartContract,
    state,
    State,
    method,
    PublicKey,
    UInt64,
    UInt32,
    Struct,
    Bool,
    Provable,
    Poseidon,
    MerkleMapWitness,
    MerkleMap, // Added MerkleMap import
    AccountUpdate, // Added AccountUpdate import
} from 'o1js';

// Intent State Enum
export const IntentState = {
    OPEN: UInt32.from(0),
    FILLED: UInt32.from(1),
    CANCELLED: UInt32.from(2),
    PENDING_LOCK: UInt32.from(3),
};

// function UInt8(x: number) { // Removed UInt8 helper function
//     return UInt32.from(x); // Using UInt32 to represent UInt8 for simplicity in PoC
// }

export class IntentStruct extends Struct({
    intentId: Field,
    makerAddress: PublicKey,
    makerAmountMina: UInt64,
    minZecZat: UInt64,
    zcashRecipientCommitment: Field,
    deadlineSlot: UInt32,
    state: UInt32, // Using UInt32 as enum container
}) {
    hash(): Field {
        return Poseidon.hash([
            this.intentId,
            ...this.makerAddress.toFields(),
            ...this.makerAmountMina.toFields(),
            ...this.minZecZat.toFields(),
            this.zcashRecipientCommitment,
            ...this.deadlineSlot.toFields(),
            ...this.state.toFields(),
        ]);
    }
}

export class ZcashOutput extends Struct({
    recipientCommitment: Field,
    amountZat: UInt64,
}) { }

export class ZcashTxData extends Struct({
    blockHeaderHash: Field,
    merkleRoot: Field,
    txid: Field,
    merklePath: Provable.Array(Field, 32),
    merkleIndex: Field, // Added index for path direction
    outputs: Provable.Array(ZcashOutput, 5),
}) { }

export class ZecBridge extends SmartContract {
    // Trusted Oracle State
    @state(Field) oracleBlockHeaderHash = State<Field>();
    @state(PublicKey) oraclePublicKey = State<PublicKey>(); // Added Oracle Public Key State

    // Intent Management
    @state(Field) nextIntentId = State<Field>();
    @state(Field) intentsRoot = State<Field>(); // MerkleMap root for intents
    @state(Field) nullifiersRoot = State<Field>(); // MerkleMap root for nullifiers

    init() {
        super.init();
        this.nextIntentId.set(Field(0));
        // Initialize with empty MerkleMap root
        const emptyMapRoot = Field(new MerkleMap().getRoot());
        this.intentsRoot.set(emptyMapRoot);
        this.nullifiersRoot.set(emptyMapRoot);

        // Hardcoded Oracle Public Key
        this.oraclePublicKey.set(PublicKey.fromBase58("B62qnNwUuiSkse4V4bnUwjQoxgJ26HBnN5Ya9c1pyq6DhgzvXW5XgZN"));
    }

    @method async setOracleBlockHeaderHash(blockHeaderHash: Field, prevHash: Field) {
        // Access Control: Verify Sender is Oracle
        const oracleKey = this.oraclePublicKey.getAndRequireEquals();
        const sender = this.sender.getAndRequireSignature();
        sender.assertEquals(oracleKey);

        const currentHash = this.oracleBlockHeaderHash.getAndRequireEquals();

        // Enforce Chain Continuity
        // The new block's prevHash must match the current stored hash.
        // Exception: If currentHash is 0 (uninitialized), we allow the update (Bootstrap).
        const isBootstrap = currentHash.equals(Field(0));
        const isValidChain = prevHash.equals(currentHash);

        isBootstrap.or(isValidChain).assertTrue("Invalid Chain Continuity: prevHash does not match current Oracle state");

        this.oracleBlockHeaderHash.set(blockHeaderHash);
    }

    // Placeholder for other methods
    @method async createIntent(
        makerAmountMina: UInt64,
        minZecZat: UInt64,
        zcashRecipientCommitment: Field,
        deadlineSlot: UInt32,
        keyWitness: MerkleMapWitness
    ) {
        const nextId = this.nextIntentId.getAndRequireEquals();
        const currentRoot = this.intentsRoot.getAndRequireEquals();

        // Verify witness against current root for the new key (nextId)
        // It should be empty (Field(0)) before insertion
        const [rootBefore, key] = keyWitness.computeRootAndKey(Field(0));
        rootBefore.assertEquals(currentRoot);
        key.assertEquals(nextId);

        const sender = this.sender.getAndRequireSignature();

        const newIntent = new IntentStruct({
            intentId: nextId,
            makerAddress: sender,
            makerAmountMina: makerAmountMina,
            minZecZat: minZecZat,
            zcashRecipientCommitment: zcashRecipientCommitment,
            deadlineSlot: deadlineSlot,
            state: IntentState.PENDING_LOCK,
        });

        // Update Merkle Map
        const [rootAfter] = keyWitness.computeRootAndKey(newIntent.hash());
        this.intentsRoot.set(rootAfter);
        this.nextIntentId.set(nextId.add(1));
    }

    @method async lockMina(intentId: Field, keyWitness: MerkleMapWitness, intent: IntentStruct) {
        const currentRoot = this.intentsRoot.getAndRequireEquals();

        // Verify the intent exists and matches the witness
        const [rootCheck, key] = keyWitness.computeRootAndKey(intent.hash());
        rootCheck.assertEquals(currentRoot);
        key.assertEquals(intentId);
        intent.intentId.assertEquals(intentId);

        // Check Sender
        const sender = this.sender.getAndRequireSignature();
        sender.assertEquals(intent.makerAddress);

        // Check State
        intent.state.assertEquals(IntentState.PENDING_LOCK);

        // Transfer MINA from sender to zkApp
        // We assume the sender approves this transfer via signature
        const update = AccountUpdate.createSigned(sender);
        update.send({ to: this.address, amount: intent.makerAmountMina });

        // Update State to OPEN
        const updatedIntent = new IntentStruct({
            ...intent,
            state: IntentState.OPEN,
        });

        const [rootAfter] = keyWitness.computeRootAndKey(updatedIntent.hash());
        this.intentsRoot.set(rootAfter);
    }

    @method async claim(
        intentId: Field,
        zcashTxData: ZcashTxData,
        keyWitness: MerkleMapWitness,
        intent: IntentStruct,
        nullifierWitness: MerkleMapWitness // Added nullifier witness
    ) {
        const currentRoot = this.intentsRoot.getAndRequireEquals();
        const currentNullifiersRoot = this.nullifiersRoot.getAndRequireEquals();

        // 1. Intent Load & Basic Checks
        const [rootCheck, key] = keyWitness.computeRootAndKey(intent.hash());
        rootCheck.assertEquals(currentRoot);
        key.assertEquals(intentId);
        intent.intentId.assertEquals(intentId);

        intent.state.assertEquals(IntentState.OPEN);

        // Check deadline
        // We use globalSlotSinceGenesis for the deadline
        const currentSlot = this.network.globalSlotSinceGenesis.getAndRequireEquals();
        currentSlot.assertLessThanOrEqual(intent.deadlineSlot);

        // 2. Header Oracle Check
        const storedHeader = this.oracleBlockHeaderHash.getAndRequireEquals();
        storedHeader.assertEquals(zcashTxData.blockHeaderHash);

        // 3. Merkle Inclusion Check
        // We assume zcashTxData.merkleRoot is trusted or verified against blockHeaderHash
        // (Note: In a real implementation, we must verify merkleRoot is part of blockHeaderHash)
        const computedRoot = MerkleHelper.computeRoot(zcashTxData.txid, zcashTxData.merklePath, zcashTxData.merkleIndex);
        computedRoot.assertEquals(zcashTxData.merkleRoot);

        // 4. Nullifier Check (Double Spend Protection)
        // Verify that the txid has NOT been used (value is 0)
        const [nullifierRootCheck, nullifierKey] = nullifierWitness.computeRootAndKey(Field(0));
        nullifierRootCheck.assertEquals(currentNullifiersRoot);
        nullifierKey.assertEquals(zcashTxData.txid);

        // Set Nullifier (Mark as used, value 1)
        const [newNullifiersRoot] = nullifierWitness.computeRootAndKey(Field(1));
        this.nullifiersRoot.set(newNullifiersRoot);

        // 5. Output Recipient & Amount Check
        let ok = Bool(false);

        for (let i = 0; i < 5; i++) {
            const output = zcashTxData.outputs[i];
            const isRecipient = output.recipientCommitment.equals(intent.zcashRecipientCommitment);
            const isEnough = output.amountZat.greaterThanOrEqual(intent.minZecZat);
            ok = ok.or(isRecipient.and(isEnough));
        }

        ok.assertTrue("No matching output found");

        // 6. Escrow Release
        // Transfer MINA from zkApp to sender (User2)
        const sender = this.sender.getAndRequireSignature();
        this.send({ to: sender, amount: intent.makerAmountMina });

        // Update State to FILLED
        const updatedIntent = new IntentStruct({
            ...intent,
            state: IntentState.FILLED,
        });

        const [rootAfter] = keyWitness.computeRootAndKey(updatedIntent.hash());
        this.intentsRoot.set(rootAfter);
    }

    @method async cancel(intentId: Field, keyWitness: MerkleMapWitness, intent: IntentStruct) {
        const currentRoot = this.intentsRoot.getAndRequireEquals();

        // Verify intent
        const [rootCheck, key] = keyWitness.computeRootAndKey(intent.hash());
        rootCheck.assertEquals(currentRoot);
        key.assertEquals(intentId);
        intent.intentId.assertEquals(intentId);

        // Check Sender (Maker)
        const sender = this.sender.getAndRequireSignature();
        sender.assertEquals(intent.makerAddress);

        // Check State
        intent.state.assertEquals(IntentState.OPEN);

        // Check Deadline (Must be passed)
        const currentSlot = this.network.globalSlotSinceGenesis.getAndRequireEquals();
        currentSlot.assertGreaterThan(intent.deadlineSlot);

        // Refund MINA to Maker
        this.send({ to: sender, amount: intent.makerAmountMina });

        // Update State to CANCELLED
        const updatedIntent = new IntentStruct({
            ...intent,
            state: IntentState.CANCELLED,
        });

        const [rootAfter] = keyWitness.computeRootAndKey(updatedIntent.hash());
        this.intentsRoot.set(rootAfter);
    }
}

class MerkleHelper {
    static computeRoot(leaf: Field, path: Field[], index: Field): Field {
        let currentHash = leaf;
        let currentIndex = index;

        // Decompose index into bits
        const indexBits = currentIndex.toBits(32);

        for (let i = 0; i < 32; i++) {
            const isRight = indexBits[i];
            const sibling = path[i];

            // If isRight, then currentHash is the right child: Hash(sibling, currentHash)
            // If !isRight, then currentHash is the left child: Hash(currentHash, sibling)

            const left = Provable.if(isRight, sibling, currentHash);
            const right = Provable.if(isRight, currentHash, sibling);

            currentHash = Poseidon.hash([left, right]);
        }
        return currentHash;
    }
}
