import { Mina, fetchTransactionStatus } from 'o1js';

const NETWORK_URL = 'https://api.minascan.io/node/devnet/v1/graphql';
const TX_HASH = '5Jv1EfJoiVErjENTkZTkbPfKXA6aGtEQVVP4j2GKSB481fGeXC6H';

async function checkTx() {
    const Network = Mina.Network(NETWORK_URL);
    Mina.setActiveInstance(Network);

    console.log(`Checking Tx: ${TX_HASH}`);
    try {
        const status = await fetchTransactionStatus(TX_HASH);
        console.log(`Status: ${status}`);
    } catch (e) {
        console.log("Error fetching status:", e);
    }
}

checkTx();
