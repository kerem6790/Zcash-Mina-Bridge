import { fetchAccount, PublicKey, Mina } from 'o1js';

const NETWORK_URL = 'https://api.minascan.io/node/devnet/v1/graphql';
const ZKAPP_ADDRESS = 'B62qnHWafr5CZifyPQpFTsv3dD1YYC9zh1nctAUqeiAr6oMYrE8Mroe';

async function main() {
    const Network = Mina.Network(NETWORK_URL);
    Mina.setActiveInstance(Network);

    console.log(`Checking account ${ZKAPP_ADDRESS}...`);
    const response = await fetchAccount({ publicKey: PublicKey.fromBase58(ZKAPP_ADDRESS) });

    if (response.account) {
        console.log('Account exists!');
        console.log('Balance:', response.account.balance.toString());
        console.log('Nonce:', response.account.nonce.toString());
        console.log('Verification Key Hash:', response.account.zkapp?.verificationKey?.hash.toString());
    } else {
        console.log('Account does not exist (yet).');
    }
}

main();
