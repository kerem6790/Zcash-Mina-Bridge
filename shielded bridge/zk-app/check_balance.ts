import { Mina, PrivateKey, PublicKey, fetchAccount } from 'o1js';

const NETWORK_URL = 'https://api.minascan.io/node/devnet/v1/graphql';

async function checkBalance() {
    const Network = Mina.Network(NETWORK_URL);
    Mina.setActiveInstance(Network);

    const key = PrivateKey.fromBase58('EKEDFNuZUf76Q9fYUGMD31p5ySKaSzgYXttZxAxMuNZtL9caneof');
    const pub = key.toPublicKey();
    console.log(`Address: ${pub.toBase58()}`);

    try {
        const response = await fetchAccount({ publicKey: pub });
        if (response.error) {
            console.log("Account not found (Balance: 0)");
        } else {
            console.log(`Balance: ${Mina.getBalance(pub).toString()}`);
        }
    } catch (e) {
        console.log("Error fetching account:", e);
    }
}

checkBalance();
