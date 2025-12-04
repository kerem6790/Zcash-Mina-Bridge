import { Mina, PublicKey, fetchAccount } from 'o1js';

const NETWORK_URL = 'https://api.minascan.io/node/devnet/v1/graphql';
const ZKAPP_ADDR = 'B62qn9HQfDgDjAAVEqkvSRW3wsXraHcVK3SuXmSbkvnC3ye2kgD3KvU';

async function checkZkApp() {
    const Network = Mina.Network(NETWORK_URL);
    Mina.setActiveInstance(Network);

    const pub = PublicKey.fromBase58(ZKAPP_ADDR);
    console.log(`Checking zkApp: ${pub.toBase58()}`);

    try {
        const response = await fetchAccount({ publicKey: pub });
        if (response.error) {
            console.log("zkApp Account not found!");
            console.log("Error:", response.error);
        } else {
            console.log("zkApp Account found!");
            console.log(`Balance: ${Mina.getBalance(pub).toString()}`);
            console.log("State:");
            response.account?.zkapp?.appState.forEach((field, i) => {
                console.log(`Field ${i}: ${field.toString()}`);
            });
            console.log(`ProvedState: ${response.account?.zkapp?.provedState}`);
        }
    } catch (e) {
        console.log("Error fetching account:", e);
    }
}

checkZkApp();
