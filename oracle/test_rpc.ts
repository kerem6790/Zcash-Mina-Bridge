import axios from 'axios';

const RPC_URL = 'https://go.getblock.io/2ea568f48d734d72b0f12b1495689043';

async function testRpc() {
    console.log(`Testing RPC: ${RPC_URL}`);

    try {
        // 1. Get Block Count
        console.log("Fetching block count...");
        const countRes = await axios.post(RPC_URL, {
            jsonrpc: '1.0',
            id: 'test',
            method: 'getblockcount',
            params: []
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        if (countRes.data.error) {
            throw new Error(`RPC Error (getblockcount): ${JSON.stringify(countRes.data.error)}`);
        }

        const height = countRes.data.result;
        console.log(`Current Block Height: ${height}`);

        // 2. Get Block Hash
        console.log(`Fetching block hash for height ${height}...`);
        const hashRes = await axios.post(RPC_URL, {
            jsonrpc: '1.0',
            id: 'test',
            method: 'getblockhash',
            params: [height]
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        if (hashRes.data.error) {
            throw new Error(`RPC Error (getblockhash): ${JSON.stringify(hashRes.data.error)}`);
        }

        const hash = hashRes.data.result;
        console.log(`Block Hash: ${hash}`);

        // 3. Get Block and Anchor
        console.log(`Fetching block ${hash} to check for Orchard anchor...`);
        const blockRes = await axios.post(RPC_URL, {
            jsonrpc: '1.0',
            id: 'test',
            method: 'getblock',
            params: [hash, 1] // Verbosity 1 for JSON
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        if (blockRes.data.error) {
            throw new Error(`RPC Error (getblock): ${JSON.stringify(blockRes.data.error)}`);
        }

        const block = blockRes.data.result;
        if (block.orchard_tree) {
            console.log(`✅ Success! Found Orchard Anchor (orchard_tree): ${block.orchard_tree}`);
        } else if (block.finalorchardroot) {
            console.log(`✅ Success! Found Orchard Anchor (finalorchardroot): ${block.finalorchardroot}`);
        } else {
            console.log("⚠️  Block found, but no anchor field.");
        }

        if (block.trees) {
            console.log("Trees field:", JSON.stringify(block.trees, null, 2));
        }

    } catch (e: any) {
        console.error("❌ RPC Test Failed:", e.message);
        if (e.response) {
            console.error("Response Data:", e.response.data);
        }
    }
}

testRpc();
