import { Field, MerkleMap, MerkleMapWitness } from 'o1js';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(__dirname, '../indexer_state.json');

interface StoredData {
    [key: string]: string; // bridgeNullifier(hex) -> "1" (used)
}

export class MerkleStore {
    private map: MerkleMap;
    private data: StoredData;

    constructor() {
        this.map = new MerkleMap();
        this.data = {};
        this.load();
    }

    private load() {
        if (fs.existsSync(DB_PATH)) {
            console.log("Loading MerkleStore from disk...");
            try {
                const raw = fs.readFileSync(DB_PATH, 'utf-8');
                this.data = JSON.parse(raw);

                // Reconstruct MerkleMap
                for (const [keyHex, val] of Object.entries(this.data)) {
                    const key = Field(BigInt(keyHex));
                    const value = Field(val); // Should be Field(1)
                    this.map.set(key, value);
                }
                console.log(`Loaded ${Object.keys(this.data).length} items. Root: ${this.map.getRoot().toString()}`);
            } catch (e) {
                console.error("Failed to load DB:", e);
            }
        } else {
            console.log("No existing DB found. Starting with empty MerkleMap.");
        }
    }

    save() {
        try {
            fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2));
            console.log("MerkleStore saved to disk.");
        } catch (e) {
            console.error("Failed to save DB:", e);
        }
    }

    getWitness(key: Field) {
        const witness = this.map.getWitness(key);
        const root = this.map.getRoot();
        const value = this.map.get(key);

        return {
            root,
            witness,
            value
        };
    }

    setUsed(key: Field) {
        this.map.set(key, Field(1));
        this.data['0x' + key.toBigInt().toString(16)] = "1";
        return this.map.getRoot();
    }

    getRoot() {
        return this.map.getRoot();
    }
}
