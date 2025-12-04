import {
    Field,
    SmartContract,
    state,
    State,
    method,
    DeployArgs,
    Permissions,
    PublicKey,
    UInt64,
    UInt32,
    Struct,
    MerkleMapWitness,
    Poseidon,
    Provable,
    Reducer,
    AccountUpdate,
    Signature,
} from 'o1js';

export class IntentStruct extends Struct({
    minaMaker: PublicKey,
    lockedAmountMina: UInt64,
    minZecAmount: UInt64,
    receiverHash: Field,
    deadlineSlot: UInt32,
    state: Field, // 0=OPEN, 1=FILLED, 2=CANCELLED
}) { }

// MerklePath32 removed as we use Oracle Signatures now

// We need a way to store intents. For a PoC with limited storage, we can use a Merkle Map or just events/actions.
// However, to enforce state transitions on-chain (like preventing double spend or cancellation), we need state.
// Since on-chain storage is limited (8 fields), we can't store all intents in state directly.
// A common pattern is to use a Merkle Map root for the state of all intents, or use a Reducer.
// For this specific requirement: "Intent kayıtları ... MerkleMap tabanlı kayıt: intentId -> IntentStruct"
// So we will store the root of the Intents Merkle Map.

export class BridgeContract extends SmartContract {
    // @state(Field) oracleAnchorRoot = State<Field>(); // Removed
    @state(Field) nextIntentId = State<Field>();
    @state(Field) usedBridgeNullifiersRoot = State<Field>(); // Root of MerkleMap for nullifiers
    @state(Field) intentsRoot = State<Field>(); // Root of MerkleMap for intents

    // Admin key for oracle updates
    @state(PublicKey) admin = State<PublicKey>();

    async deploy(args: DeployArgs) {
        await super.deploy(args);
        this.account.permissions.set({
            ...Permissions.default(),
            editState: Permissions.proofOrSignature(),
        });
    }

    @method async initialize(admin: PublicKey) {
        this.account.provedState.requireEquals(this.account.provedState.get());
        this.account.provedState.get().assertFalse();
        super.init();
        this.admin.set(admin);
        this.nextIntentId.set(Field(0));
        // Initialize empty roots
        const emptyRoot = Field("22731122946631793544306773678309960639073656601863129978322145324846701682624");
        this.usedBridgeNullifiersRoot.set(emptyRoot);
        this.intentsRoot.set(emptyRoot);
    }

    // adminUpdateAnchor removed

    @method async updateAdmin(newAdmin: PublicKey) {
        const admin = this.admin.getAndRequireEquals();
        const sender = this.sender.getAndRequireSignature();
        sender.assertEquals(admin);
        this.admin.set(newAdmin);
    }

    @method async createIntent(
        minZecAmount: UInt64,
        receiverHash: Field,
        deadlineSlot: UInt32,
        amountToLock: UInt64,
        keyWitness: MerkleMapWitness
    ) {
        const currentIntentId = this.nextIntentId.getAndRequireEquals();
        const currentIntentsRoot = this.intentsRoot.getAndRequireEquals();
        const sender = this.sender.getAndRequireSignature();

        // Lock MINA
        const senderUpdate = AccountUpdate.createSigned(sender);
        senderUpdate.send({ to: this.address, amount: amountToLock });

        // Create Intent
        const intent = new IntentStruct({
            minaMaker: sender,
            lockedAmountMina: amountToLock,
            minZecAmount: minZecAmount,
            receiverHash: receiverHash,
            deadlineSlot: deadlineSlot,
            state: Field(0), // OPEN
        });

        // Update Intents Merkle Map
        // We expect the witness to match the current root and the key to be currentIntentId
        const [root, key] = keyWitness.computeRootAndKey(Field(0)); // Old value is 0 (empty)
        root.assertEquals(currentIntentsRoot);
        key.assertEquals(currentIntentId);

        // Compute new root
        const newRoot = keyWitness.computeRootAndKey(Poseidon.hash(IntentStruct.toFields(intent)))[0];
        this.intentsRoot.set(newRoot);

        // Increment ID
        this.nextIntentId.set(currentIntentId.add(1));
    }

    @method async cancel(
        intentId: Field,
        intent: IntentStruct,
        keyWitness: MerkleMapWitness
    ) {
        const currentIntentsRoot = this.intentsRoot.getAndRequireEquals();

        // Verify inclusion
        const [root, key] = keyWitness.computeRootAndKey(Poseidon.hash(IntentStruct.toFields(intent)));
        root.assertEquals(currentIntentsRoot);
        key.assertEquals(intentId);

        // Check conditions
        intent.state.assertEquals(Field(0)); // Must be OPEN
        intent.minaMaker.assertEquals(this.sender.getAndRequireSignature()); // Only maker can cancel

        // Check deadline
        const currentSlot = this.network.globalSlotSinceGenesis.getAndRequireEquals();
        currentSlot.assertGreaterThan(intent.deadlineSlot);

        // Return funds
        this.send({ to: intent.minaMaker, amount: intent.lockedAmountMina });

        // Update state to CANCELLED
        const cancelledIntent = new IntentStruct({
            ...intent,
            state: Field(2), // CANCELLED
        });

        const newRoot = keyWitness.computeRootAndKey(Poseidon.hash(IntentStruct.toFields(cancelledIntent)))[0];
        this.intentsRoot.set(newRoot);
    }



    @method async claim(
        intentId: Field,
        intent: IntentStruct,
        keyWitness: MerkleMapWitness,
        nullifierWitness: MerkleMapWitness,
        // Claim details
        claimedAmount: UInt64,
        receiverHash: Field,
        bridgeNullifier: Field,
        // Oracle Signature
        oracleSignature: Signature
    ) {
        const currentIntentsRoot = this.intentsRoot.getAndRequireEquals();
        const currentNullifiersRoot = this.usedBridgeNullifiersRoot.getAndRequireEquals();
        const adminKey = this.admin.getAndRequireEquals();

        // 1. Verify Intent Inclusion
        const [iRoot, iKey] = keyWitness.computeRootAndKey(Poseidon.hash(IntentStruct.toFields(intent)));
        iRoot.assertEquals(currentIntentsRoot);
        iKey.assertEquals(intentId);

        // 2. Verify Intent State
        intent.state.assertEquals(Field(0)); // OPEN
        const currentSlot = this.network.globalSlotSinceGenesis.getAndRequireEquals();
        currentSlot.assertLessThanOrEqual(intent.deadlineSlot);

        // 3. Verify Nullifier Non-inclusion
        const [nRoot, nKey] = nullifierWitness.computeRootAndKey(Field(0)); // Should be empty (0)
        nRoot.assertEquals(currentNullifiersRoot);
        nKey.assertEquals(bridgeNullifier);

        // 4. Verify Oracle Signature
        // The Oracle signs: [bridgeNullifier, claimedAmount, receiverHash]
        // ensuring that the Zcash note with this nullifier pays this amount to this receiver.
        const validSignature = oracleSignature.verify(adminKey, [
            bridgeNullifier,
            ...claimedAmount.toFields(),
            receiverHash
        ]);
        validSignature.assertTrue("Invalid Oracle Signature");

        // 5. Verify Claim Matches Intent
        intent.receiverHash.assertEquals(receiverHash);
        claimedAmount.assertGreaterThanOrEqual(intent.minZecAmount);

        // 6. Execute Claim
        this.send({ to: this.sender.getAndRequireSignature(), amount: intent.lockedAmountMina });

        // 7. Update Intent State to FILLED
        const filledIntent = new IntentStruct({
            ...intent,
            state: Field(1), // FILLED
        });
        const newIntentsRoot = keyWitness.computeRootAndKey(Poseidon.hash(IntentStruct.toFields(filledIntent)))[0];
        this.intentsRoot.set(newIntentsRoot);

        // 8. Update Nullifier Set
        const newNullifiersRoot = nullifierWitness.computeRootAndKey(Field(1))[0];
        this.usedBridgeNullifiersRoot.set(newNullifiersRoot);
    }
}

