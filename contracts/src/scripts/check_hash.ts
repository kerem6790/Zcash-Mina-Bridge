import { IntentStruct, IntentState } from '../ZecBridge.js';
import { Field, PublicKey, UInt64, UInt32, Poseidon } from 'o1js';

async function main() {
    const intentData = {
        "intentId": "2",
        "makerAddress": "B62qqqU1wgAG6aZewAQHws7WoHkQVoceQ6XVXDbMMoM9Pa6uNqDzMmY",
        "makerAmountMina": "1000000000",
        "minZecZat": "100000",
        "zcashRecipientCommitment": "12345",
        "deadlineSlot": "2000000",
        "state": 0
    };

    const intent = new IntentStruct({
        intentId: Field(intentData.intentId),
        makerAddress: PublicKey.fromBase58(intentData.makerAddress),
        makerAmountMina: UInt64.from(intentData.makerAmountMina),
        minZecZat: UInt64.from(intentData.minZecZat),
        zcashRecipientCommitment: Field(intentData.zcashRecipientCommitment),
        deadlineSlot: UInt32.from(intentData.deadlineSlot),
        state: UInt32.from(intentData.state)
    });

    console.log(`Computed Hash: ${intent.hash().toString()}`);
    console.log(`Expected Hash: 6259581141304145248399356757970302165502323728039867655151472423883156599164`);
}

main();
