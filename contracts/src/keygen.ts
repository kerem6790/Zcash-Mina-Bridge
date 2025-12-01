import { PrivateKey } from 'o1js';
import * as fs from 'fs';

async function main() {
    const key = PrivateKey.random();
    const pub = key.toPublicKey();

    const keyData = {
        privateKey: key.toBase58(),
        publicKey: pub.toBase58()
    };

    fs.writeFileSync('keys.json', JSON.stringify(keyData, null, 2));
    console.log('Keys generated and saved to keys.json');
    console.log('Public Key:', pub.toBase58());
}

main();
