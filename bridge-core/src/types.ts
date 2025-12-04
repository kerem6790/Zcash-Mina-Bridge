export interface MinaBridgeExportV1 {
    version: 1;
    network: "testnet" | "mainnet";

    // Zcash tx meta
    txid: string;         // hex
    blockHeight?: number; // optional

    // Bridge specific
    intentHint?: string;

    orchard: {
        // Note data
        pk_d_receiver: string;  // hex
        value: string;          // zatoshi (string)
        rseed: string;          // hex
        rho: string;            // hex

        // Commitment & anchor
        cm: string;             // hex, note commitment
        anchor: string;         // hex, Orchard note commitment tree root

        // Merkle path
        merklePath: string[];   // hex sibling hash list
        position: number;       // leaf index

        // Nullifier
        nf: string;             // hex
    };
}

// Intent structure for frontend/prover usage (not the on-chain struct directly, but compatible)
export interface IntentData {
    intentId: string;
    minaMaker: string; // PublicKey base58
    lockedAmountMina: string; // uint64 string
    minZecAmount: string; // uint64 string
    receiverHash: string; // field string
    deadlineSlot: string; // uint64 string
    state: 'OPEN' | 'FILLED' | 'CANCELLED';
}
