import { ZecBridge } from '../ZecBridge.js';
import { MerkleMap, Field, PublicKey, Mina, fetchAccount } from 'o1js';
import * as fs from 'fs';
import { MINA_GRAPHQL_ENDPOINT, ZECBRIDGE_ADDRESS } from '../config.js';

async function main() {
    const Network = Mina.Network(MINA_GRAPHQL_ENDPOINT);
    Mina.setActiveInstance(Network);

    const zkAppAddress = PublicKey.fromBase58(ZECBRIDGE_ADDRESS);
    await fetchAccount({ publicKey: zkAppAddress });
    const zkApp = new ZecBridge(zkAppAddress);

    const onChainRoot = zkApp.intentsRoot.get();
    console.log(`On-chain Root: ${onChainRoot.toString()}`);

    if (fs.existsSync('merkle_map.json')) {
        const mapData = JSON.parse(fs.readFileSync('merkle_map.json', 'utf8'));
        const map = new MerkleMap();
        for (const [key, value] of Object.entries(mapData)) {
            map.set(Field(key), Field(value as string));
        }
        console.log(`Local Map Root: ${map.getRoot().toString()}`);
        console.log('Map Keys:', Object.keys(mapData));
    } else {
        console.log('merkle_map.json not found!');
    }
}

main().catch(console.error);
