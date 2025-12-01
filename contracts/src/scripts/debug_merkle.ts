import { Field, Poseidon, Provable } from 'o1js';

// Simulate Circuit Logic
function circuitComputeRoot(leaf: Field, path: Field[], index: Field): Field {
    let currentHash = leaf;
    let currentIndex = index;

    const indexBits = currentIndex.toBits(32);

    for (let i = 0; i < 32; i++) {
        const isRight = indexBits[i];
        const sibling = path[i];

        // We can't use Provable.if in plain JS execution without a circuit context easily,
        // but for constant inputs, we can simulate it.
        // Actually, toBits returns variables.
        // Let's use simple JS logic mimicking the circuit.
        const isRightBool = isRight.toBoolean();

        const left = isRightBool ? sibling : currentHash;
        const right = isRightBool ? currentHash : sibling;

        currentHash = Poseidon.hash([left, right]);
    }
    return currentHash;
}

// JS Logic from zcash_utils.ts
class MerkleTreeUtils {
    static getPath(leaves: Field[], index: number): Field[] {
        let currentLevel = [...leaves];
        const path: Field[] = [];

        for (let level = 0; level < 32; level++) {
            if (currentLevel.length === 1) {
                path.push(Field(0));
                currentLevel = [Poseidon.hash([currentLevel[0], Field(0)])];
                continue;
            }

            const nextLevel: Field[] = [];
            const isRight = index % 2 === 1;
            const siblingIndex = isRight ? index - 1 : index + 1;

            const sibling = siblingIndex < currentLevel.length ? currentLevel[siblingIndex] : currentLevel[currentLevel.length - 1];
            path.push(sibling);

            for (let i = 0; i < currentLevel.length; i += 2) {
                const left = currentLevel[i];
                const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
                nextLevel.push(Poseidon.hash([left, right]));
            }

            currentLevel = nextLevel;
            index = Math.floor(index / 2);
        }
        return path;
    }

    static computeRootFromLeaves(leaves: Field[]): Field {
        let currentLevel = [...leaves];
        for (let level = 0; level < 32; level++) {
            if (currentLevel.length === 1) {
                currentLevel = [Poseidon.hash([currentLevel[0], Field(0)])];
                continue;
            }
            const nextLevel: Field[] = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                const left = currentLevel[i];
                const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
                nextLevel.push(Poseidon.hash([left, right]));
            }
            currentLevel = nextLevel;
        }
        return currentLevel[0];
    }
}

async function main() {
    for (let len = 1; len <= 20; len++) {
        // console.log(`\nTesting Length: ${len}`);
        const leaves = [];
        for (let i = 0; i < len; i++) leaves.push(Field(i + 1));

        // Test all indices
        for (let index = 0; index < len; index++) {
            const leaf = leaves[index];
            const rootJS = MerkleTreeUtils.computeRootFromLeaves(leaves);
            const path = MerkleTreeUtils.getPath(leaves, index);
            const rootCircuit = circuitComputeRoot(leaf, path, Field(index));

            if (rootJS.equals(rootCircuit).toBoolean()) {
                console.log(`Index ${index}: MATCH`);
            } else {
                console.log(`Index ${index}: MISMATCH`);
                console.log('Root JS:', rootJS.toString());
                console.log('Root Circuit:', rootCircuit.toString());
            }
        }
    }
}

main();
