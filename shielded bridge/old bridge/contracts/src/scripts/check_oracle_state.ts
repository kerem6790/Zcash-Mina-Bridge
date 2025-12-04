import { ZecBridge } from '../ZecBridge.js';
import { PublicKey, Mina, fetchAccount } from 'o1js';
import { MINA_GRAPHQL_ENDPOINT, ZECBRIDGE_ADDRESS } from '../config.js';

async function main() {
    const Network = Mina.Network(MINA_GRAPHQL_ENDPOINT);
    Mina.setActiveInstance(Network);

    const zkAppAddress = PublicKey.fromBase58(ZECBRIDGE_ADDRESS);
    await fetchAccount({ publicKey: zkAppAddress });
    const zkApp = new ZecBridge(zkAppAddress);

    const currentHash = zkApp.oracleBlockHeaderHash.get();
    console.log(`Current Oracle Hash: ${currentHash.toString()}`);

    // Expected Hash for block 00069...
    const expectedHash = "14733674208667371217306857565440881244021185140504269352337524832980523811844";

    if (currentHash.toString() === expectedHash) {
        console.log("SUCCESS: Oracle is updated to the correct block!");
    } else {
        console.log("FAILURE: Oracle is NOT updated.");
        console.log(`Expected: ${expectedHash}`);
    }
}

main().catch(console.error);
