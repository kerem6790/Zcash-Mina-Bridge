import { Mina, PrivateKey, AccountUpdate } from 'o1js';
import { BridgeContract } from './src/BridgeContract';

const NETWORK_URL = 'https://api.minascan.io/node/devnet/v1/graphql';
const DEPLOYER_KEY = 'EKFFostjkp4arnySMXrsA2Ukrkc3ShidWxDxvehUje6P4FverH28';

async function deploy() {
    console.log("Initializing network...");
    const Network = Mina.Network(NETWORK_URL);
    Mina.setActiveInstance(Network);

    const deployerKey = PrivateKey.fromBase58(DEPLOYER_KEY);
    const deployerAccount = deployerKey.toPublicKey();
    console.log(`Deployer: ${deployerAccount.toBase58()}`);

    // Compile
    console.log("Compiling contract...");
    const { verificationKey } = await BridgeContract.compile();

    // Deploy
    console.log("Deploying contract...");
    const zkAppKey = PrivateKey.random();
    const zkAppAddress = zkAppKey.toPublicKey();
    const zkApp = new BridgeContract(zkAppAddress);

    const deployTx = await Mina.transaction({ sender: deployerAccount, fee: 1_000_000_000 }, async () => {
        AccountUpdate.fundNewAccount(deployerAccount);
        await zkApp.deploy({ verificationKey });
        await zkApp.initialize(deployerAccount); // Set deployer as admin
    });
    await deployTx.prove();
    const sentTx = await deployTx.sign([deployerKey, zkAppKey]).send();

    console.log(`Deploy Tx Hash: ${sentTx.hash}`);
    console.log(`zkApp Address: ${zkAppAddress.toBase58()}`);

    if (sentTx.hash) {
        console.log("SUCCESS! Please update your .env files with the new zkApp Address.");
    } else {
        console.error("Deployment failed.");
    }
}

deploy().catch(console.error);
