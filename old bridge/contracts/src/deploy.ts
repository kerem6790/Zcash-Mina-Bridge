import { Counter } from './Counter';
import { PrivateKey, Mina, AccountUpdate, fetchAccount } from 'o1js';

// Network configuration
const NETWORK_URL = 'https://api.minascan.io/node/berkeley/v1/graphql';

async function main() {
    console.log('Compiling Counter zkApp...');
    await Counter.compile();

    // Load deployer key from file
    const fs = require('fs');
    if (!fs.existsSync('keys.json')) {
        console.error('keys.json not found. Run keygen.ts first.');
        process.exit(1);
    }
    const keyData = JSON.parse(fs.readFileSync('keys.json', 'utf8'));
    const deployerKey = PrivateKey.fromBase58(keyData.privateKey);
    const deployerAddr = deployerKey.toPublicKey();

    console.log('-------------------------------------------');
    console.log('Deployer Public Key:', deployerAddr.toBase58());
    console.log('-------------------------------------------');
    console.log('Please fund this address using the Mina Berkeley Faucet: https://faucet.minaprotocol.com/');
    console.log('Waiting for funds...');

    // Set up Mina instance
    const Network = Mina.Network(NETWORK_URL);
    Mina.setActiveInstance(Network);

    // Loop to check for funds
    while (true) {
        try {
            const response = await fetchAccount({ publicKey: deployerAddr });
            if (response.account) {
                console.log('Funds received! Balance:', response.account.balance.toString());
                break;
            }
        } catch (e) {
            // Ignore errors while waiting
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
        process.stdout.write('.');
    }

    console.log('\nDeploying zkApp...');
    const zkAppPrivateKey = PrivateKey.random();
    const zkAppAddress = zkAppPrivateKey.toPublicKey();
    const zkApp = new Counter(zkAppAddress);

    const deployTx = await Mina.transaction(deployerAddr, async () => {
        AccountUpdate.fundNewAccount(deployerAddr);
        await zkApp.deploy();
    });

    await deployTx.prove();
    await deployTx.sign([deployerKey, zkAppPrivateKey]).send();

    console.log('Successfully deployed at:', zkAppAddress.toBase58());
    console.log('Initial state:', zkApp.num.get().toString());
}

main().catch(console.error);
