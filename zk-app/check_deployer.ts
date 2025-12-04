import { Mina, PublicKey, fetchAccount } from 'o1js';

const NETWORK_URL = 'https://api.minascan.io/node/devnet/v1/graphql';
const DEPLOYER_ADDR = 'B62qnNwUuiSkse4V4bnUwjQoxgJ26HBnN5Ya9c1pyq6DhgzvXW5XgZN';

async function checkDeployer() {
    const Network = Mina.Network(NETWORK_URL);
    Mina.setActiveInstance(Network);

    const pub = PublicKey.fromBase58(DEPLOYER_ADDR);
    console.log(`Checking Deployer: ${pub.toBase58()}`);

    try {
        const response = await fetchAccount({ publicKey: pub });
        if (response.error) {
            console.log("Deployer Account not found!");
        } else {
            console.log(`Balance: ${Mina.getBalance(pub).toString()}`);
            console.log(`Nonce: ${response.account?.nonce.toString()}`);
        }
    } catch (e) {
        console.log("Error fetching account:", e);
    }
}

checkDeployer();
