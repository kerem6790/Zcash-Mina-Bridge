import { ZecBridge } from '../ZecBridge.js';
import { PrivateKey, Mina, AccountUpdate, fetchAccount, UInt64 } from 'o1js';
import { MINA_GRAPHQL_ENDPOINT, DEPLOYER_PRIVATE_KEY } from '../config.js';

async function main() {
    console.log('Compiling ZecBridge...');
    await ZecBridge.compile();

    // Load deployer key
    if (!DEPLOYER_PRIVATE_KEY) {
        console.error('DEPLOYER_PRIVATE_KEY not set in config/env.');
        process.exit(1);
    }
    const deployerKey = PrivateKey.fromBase58(DEPLOYER_PRIVATE_KEY);
    const deployerAddr = deployerKey.toPublicKey();

    console.log('Deployer:', deployerAddr.toBase58());

    // Setup Mina
    const Network = Mina.Network(MINA_GRAPHQL_ENDPOINT);
    Mina.setActiveInstance(Network);

    const { account } = await fetchAccount({ publicKey: deployerAddr });
    const balance = account?.balance || UInt64.from(0);
    console.log('Deployer Balance:', balance.toString());

    if (balance.lessThan(UInt64.from(1_000_000_000)).toBoolean()) { // Check for at least 1 MINA
        console.error('Insufficient balance. Please fund the deployer account.');
        process.exit(1);
    }

    console.log('Deploying zkApp...');
    const zkAppPrivateKey = PrivateKey.random();
    const zkAppAddress = zkAppPrivateKey.toPublicKey();

    console.log('zkApp Address:', zkAppAddress.toBase58());
    console.log('zkApp Private Key:', zkAppPrivateKey.toBase58());

    const zkApp = new ZecBridge(zkAppAddress);

    const deployTx = await Mina.transaction({ sender: deployerAddr, fee: 200_000_000 }, async () => {
        AccountUpdate.fundNewAccount(deployerAddr);
        await zkApp.deploy();
    });

    await deployTx.prove();
    const sentTx = await deployTx.sign([deployerKey, zkAppPrivateKey]).send();

    console.log('Deploy Tx Hash:', sentTx.hash);
    console.log('Successfully sent deploy transaction. Waiting for inclusion...');

    await sentTx.wait();

    console.log('Successfully deployed at:', zkAppAddress.toBase58());
    console.log(`export ZKAPP_ADDRESS=${zkAppAddress.toBase58()}`);
}

main().catch(console.error);
