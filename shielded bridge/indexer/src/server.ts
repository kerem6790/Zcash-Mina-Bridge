import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Field } from 'o1js';
import { MerkleStore } from './merkleStore';
import { MinaClient } from './minaClient';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const MINA_RPC = process.env.MINA_RPC_URL || 'https://api.minascan.io/node/devnet/v1/graphql';
const ZKAPP_ADDR = process.env.ZKAPP_ADDRESS || '';

const store = new MerkleStore();
const mina = new MinaClient(MINA_RPC, ZKAPP_ADDR);

// Helper to serialize witness
function serializeWitness(witness: any) {
    // MerkleMapWitness has isLeft (bool[]) and siblings (Field[])
    return {
        isLeft: witness.isLeft,
        siblings: witness.siblings.map((s: Field) => s.toString())
    };
}

app.post('/witness/bridgeNullifier', async (req, res) => {
    try {
        const { bridgeNullifier } = req.body;
        if (!bridgeNullifier) {
            return res.status(400).json({ error: 'Missing bridgeNullifier' });
        }

        const key = Field(BigInt(bridgeNullifier)); // Expecting hex or number string
        const { root, witness, value } = store.getWitness(key);

        // Optional: Check against on-chain root
        // const onChainRoot = await mina.getOnChainRoot();
        // if (!root.equals(onChainRoot).toBoolean()) {
        //   console.warn("Local root differs from on-chain root!");
        // }

        res.json({
            root: root.toString(),
            key: key.toString(),
            oldValue: value.toString(),
            witness: serializeWitness(witness)
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/update/bridgeNullifier', async (req, res) => {
    try {
        const { bridgeNullifier } = req.body;
        if (!bridgeNullifier) {
            return res.status(400).json({ error: 'Missing bridgeNullifier' });
        }

        const key = Field(BigInt(bridgeNullifier));
        const newRoot = store.setUsed(key);
        store.save();

        res.json({
            status: 'ok',
            newRoot: newRoot.toString()
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/health', async (req, res) => {
    const localRoot = store.getRoot();
    let onChainRoot = null;
    try {
        onChainRoot = await mina.getOnChainRoot();
    } catch (e) {
        console.error("Failed to get on-chain root for health check");
    }

    res.json({
        status: 'ok',
        localRoot: localRoot.toString(),
        onChainRoot: onChainRoot ? onChainRoot.toString() : 'error'
    });
});

app.listen(PORT, () => {
    console.log(`Indexer running on port ${PORT}`);
});
