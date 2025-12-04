import { Mina, PrivateKey, AccountUpdate, Field, UInt64, UInt32, Poseidon, MerkleMap, MerkleMapWitness, PublicKey } from 'o1js';
import { BridgeContract, IntentStruct, MerklePath32 } from './src/BridgeContract';

async function main() {
    console.log("🚀 Starting Local E2E Test...");

    // 1. Setup Local Network
    const Local = await Mina.LocalBlockchain({ proofsEnabled: false });
    Mina.setActiveInstance(Local);

    const deployerKey = Local.testAccounts[0].key;
    const deployerAccount = deployerKey.toPublicKey();
    console.log(`Deployer: ${deployerAccount.toBase58()}`);

    // 2. Compile
    console.log("📦 Compiling Contract...");
    const { verificationKey } = await BridgeContract.compile();

    // 3. Deploy Fresh Contract
    console.log("🚀 Deploying New Contract...");
    const zkAppKey = PrivateKey.random();
    const zkAppAddress = zkAppKey.toPublicKey();
    const zkApp = new BridgeContract(zkAppAddress);

    const deployTx = await Mina.transaction(deployerAccount, async () => {
        AccountUpdate.fundNewAccount(deployerAccount);
        await zkApp.deploy({ verificationKey });
        await zkApp.initialize(deployerAccount);
    });
    await deployTx.prove();
    await deployTx.sign([deployerKey, zkAppKey]).send();
    console.log(`✅ Deployed at: ${zkAppAddress.toBase58()}`);

    // 4. Create Intent
    console.log("📝 Creating Intent...");

    // Mock Data
    const amountToLock = UInt64.from(10 * 1e9); // 10 MINA
    const minZecAmount = UInt64.from(100000);
    const receiverPkD = Field(12345); // Mock receiver
    const receiverHash = Poseidon.hash([receiverPkD]);
    const deadline = UInt32.from(200000); // Far future

    // Witness for empty map (since fresh contract)
    const intentsMap = new MerkleMap();
    const nextIntentId = Field(0);
    const keyWitness = intentsMap.getWitness(nextIntentId);

    const createTx = await Mina.transaction(deployerAccount, async () => {
        await zkApp.createIntent(
            minZecAmount,
            receiverHash,
            deadline,
            amountToLock,
            keyWitness
        );
    });
    await createTx.prove();
    await createTx.sign([deployerKey]).send();
    console.log(`✅ Intent Created!`);

    // Update local map to match contract state
    const intent = new IntentStruct({
        minaMaker: deployerAccount,
        lockedAmountMina: amountToLock,
        minZecAmount: minZecAmount,
        receiverHash: receiverHash,
        deadlineSlot: deadline,
        state: Field(0), // OPEN
    });
    intentsMap.set(nextIntentId, Poseidon.hash(IntentStruct.toFields(intent)));

    // 5. Prepare Mock Proof & Update Anchor
    console.log("🔧 Preparing Mock Proof & Anchor...");

    // We need a Merkle Path that leads to a root.
    // We'll construct a simple path where our commitment is at index 0.
    const cm = Poseidon.hash([receiverPkD, minZecAmount.value, Field(0), Field(0)]); // rseed=0, rho=0

    // Construct path
    // We need 32 siblings. Let's just make them all 0 for simplicity.
    const pathElements: Field[] = new Array(32).fill(Field(0));

    // Compute the root manually as the contract does
    let currentHash = cm;
    const position = Field(0);
    const pathBits = position.toBits(32);

    for (let i = 0; i < 32; i++) {
        const sibling = pathElements[i];
        const isRight = pathBits[i];
        currentHash = isRight
            ? Poseidon.hash([sibling, currentHash])
            : Poseidon.hash([currentHash, sibling]);
    }
    const mockAnchorRoot = currentHash;
    console.log(`Computed Mock Anchor: ${mockAnchorRoot.toString()}`);

    // Update Anchor on Contract (Acting as Oracle)
    console.log("🔮 Updating Anchor (Oracle Action)...");
    const updateTx = await Mina.transaction(deployerAccount, async () => {
        await zkApp.adminUpdateAnchor(mockAnchorRoot);
    });
    await updateTx.prove();
    await updateTx.sign([deployerKey]).send();
    console.log("✅ Anchor Updated!");

    // 6. Claim
    console.log("💰 Claiming...");

    // Witnesses
    const claimIntentId = Field(0);
    const claimKeyWitness = intentsMap.getWitness(claimIntentId);

    // Nullifier Witness (Empty map)
    const nullifiersMap = new MerkleMap();
    const nf = Field(999); // Random nullifier
    const bridgeNullifier = Poseidon.hash([nf, claimIntentId]);
    const nullifierWitness = nullifiersMap.getWitness(bridgeNullifier);

    // Merkle Path Struct
    const merklePathStruct = new MerklePath32({
        path: pathElements
    });

    const claimTx = await Mina.transaction(deployerAccount, async () => {
        await zkApp.claim(
            claimIntentId,
            intent,
            claimKeyWitness,
            nullifierWitness,
            minZecAmount, // claimedAmount matches value
            receiverHash,
            mockAnchorRoot,
            bridgeNullifier,
            cm,
            receiverPkD,
            minZecAmount, // value
            Field(0), // rseed
            Field(0), // rho
            merklePathStruct,
            position,
            nf
        );
    });
    await claimTx.prove();
    await claimTx.sign([deployerKey]).send();
    console.log(`✅ Claim Successful!`);

    console.log("🎉 Full Local E2E Test Passed!");
}

main().catch(console.error);
