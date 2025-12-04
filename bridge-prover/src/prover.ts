import { Field, UInt64, Poseidon, MerkleMapWitness } from 'o1js';
import { MinaBridgeExportV1, parseMinaBridgeExport } from 'bridge-core';
import { IntentStruct, MerklePath32 } from 'zk-app';

// Helper to convert hex to Field
function hexToField(hex: string): Field {
    return Field(BigInt('0x' + hex));
}

export interface ClaimProof {
    intentId: Field;
    intent: IntentStruct;
    keyWitness: MerkleMapWitness;
    nullifierWitness: MerkleMapWitness;
    claimedAmount: UInt64;
    receiverHash: Field;
    anchorPublic: Field;
    bridgeNullifier: Field;
    cm: Field;
    // Private witnesses
    pk_d_receiver: Field;
    value: UInt64;
    rseed: Field;
    rho: Field;
    merklePath: MerklePath32;
    position: Field;
    nf: Field;
}

export async function proveClaim(
    jsonExport: string,
    intent: IntentStruct,
    intentId: Field,
    keyWitness: MerkleMapWitness,
    nullifierWitness: MerkleMapWitness
): Promise<ClaimProof> {
    const data: MinaBridgeExportV1 = parseMinaBridgeExport(jsonExport);
    const orchard = data.orchard;

    // 1. Parse fields
    const pk_d_receiver = hexToField(orchard.pk_d_receiver); // In reality pk_d is larger, we assume it fits or is hashed
    const value = UInt64.from(orchard.value);
    const rseed = hexToField(orchard.rseed);
    const rho = hexToField(orchard.rho);
    const cm = hexToField(orchard.cm);
    const anchor = hexToField(orchard.anchor);
    const nf = hexToField(orchard.nf);
    const position = Field(orchard.position);

    // Merkle Path conversion
    const merklePath = new MerklePath32({ path: orchard.merklePath.map(h => hexToField(h)) });

    // 2. Compute Public Inputs
    // receiverHash = Poseidon(pk_d_receiver)
    // Note: This must match the hashing algo used in createIntent
    const receiverHash = Poseidon.hash([pk_d_receiver]);

    // bridgeNullifier = Poseidon(nf || intentId)
    const bridgeNullifier = Poseidon.hash([nf, intentId]);

    // 3. Verify consistency (Client-side check before sending)
    // Check if receiverHash matches intent
    if (!receiverHash.equals(intent.receiverHash).toBoolean()) {
        throw new Error("Receiver hash mismatch: Wallet export does not match Intent receiver");
    }

    // Check amount
    if (value.lessThan(intent.minZecAmount).toBoolean()) {
        throw new Error("Insufficient ZEC amount in export");
    }

    return {
        intentId,
        intent,
        keyWitness,
        nullifierWitness,
        claimedAmount: value,
        receiverHash,
        anchorPublic: anchor,
        bridgeNullifier,
        cm,
        pk_d_receiver,
        value,
        rseed,
        rho,
        merklePath,
        position,
        nf
    };
}
