import { Mina, PrivateKey, AccountUpdate, PublicKey } from 'o1js';
import { BridgeContract } from './src/BridgeContract';

const NETWORK_URL = 'https://api.minascan.io/node/devnet/v1/graphql';
const DEPLOYER_KEY = 'EKFFostjkp4arnySMXrsA2Ukrkc3ShidWxDxvehUje6P4FverH28';
const ZKAPP_ADDR = 'B62qn9HQfDgDjAAVEqkvSRW3wsXraHcVK3SuXmSbkvnC3ye2kgD3KvU';

async function init() {
    console.log("Initializing network...");
    const Network = Mina.Network(NETWORK_URL);
    Mina.setActiveInstance(Network);

    const deployerKey = PrivateKey.fromBase58(DEPLOYER_KEY);
    const deployerAccount = deployerKey.toPublicKey();
    console.log(`Deployer: ${deployerAccount.toBase58()}`);

    const zkAppPublicKey = PublicKey.fromBase58(ZKAPP_ADDR);
    const zkApp = new BridgeContract(zkAppPublicKey);

    console.log("Compiling...");
    await BridgeContract.compile();

    console.log("Sending initialize tx...");
    const tx = await Mina.transaction({ sender: deployerAccount, fee: 100_000_000 }, async () => {
        await zkApp.initialize(deployerAccount);
    });

    await tx.prove();
    const sentTx = await tx.sign([deployerKey]).send();

    console.log(`Init Tx Hash: ${sentTx.hash}`);
}

init().catch(console.error);
