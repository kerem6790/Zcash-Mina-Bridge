import { Mina, PrivateKey, Field, UInt64, UInt32, Poseidon, MerkleMap, PublicKey, fetchAccount } from 'o1js';
import { BridgeContract, IntentStruct } from './src/BridgeContract';

const NETWORK_URL = 'https://api.minascan.io/node/devnet/v1/graphql';
const DEPLOYER_KEY = 'EKFFostjkp4arnySMXrsA2Ukrkc3ShidWxDxvehUje6P4FverH28';
const ZKAPP_ADDR = 'B62qnoC1EUAQuiSrUG8VCA5DCZijm65ovWgESBct776SpkunSRe3oo3';

async function main() {
    console.log("🚀 Testing createIntent on Live Contract...");

    const Network = Mina.Network(NETWORK_URL);
    Mina.setActiveInstance(Network);

    const deployerKey = PrivateKey.fromBase58(DEPLOYER_KEY);
    const deployerAccount = deployerKey.toPublicKey();
    console.log(`User: ${deployerAccount.toBase58()}`);

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
            console.log(`Current root: ${currentRoot?.toString()}. Waiting...`);
        }
        await new Promise(r => setTimeout(r, 10000));
    }

    // Prepare Intent Data
    const amountToLock = UInt64.from(1 * 1e9); // 1 MINA
    const minZecAmount = UInt64.from(10000);
    const receiverPkD = Field(12345);
    const receiverHash = Poseidon.hash([receiverPkD]);
    const deadline = UInt32.from(200000);

    // Witness for empty map (assuming slot 0 is empty)
    // In a real scenario, we'd check the contract state or indexer.
    // Since we just deployed and initialized, it should be empty.
    const intentsMap = new MerkleMap();
    const nextIntentId = Field(0); // Assuming 0
    const keyWitness = intentsMap.getWitness(nextIntentId);

    console.log("Sending createIntent transaction...");
    const tx = await Mina.transaction({ sender: deployerAccount, fee: 200_000_000 }, async () => {
        await zkApp.createIntent(
            minZecAmount,
            receiverHash,
            deadline,
            amountToLock,
            keyWitness
        );
    });

    await tx.prove();
    const sentTx = await tx.sign([deployerKey]).send();

    console.log(`✅ Transaction Sent! Hash: ${sentTx.hash}`);
    console.log("Waiting for block inclusion...");
    await sentTx.wait();
    console.log("✅ Transaction Confirmed!");
}

main().catch(console.error);
