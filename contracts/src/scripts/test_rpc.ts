import axios from 'axios';

const RPC_URL = 'https://zcash-testnet.gateway.tatum.io';

async function testRpc() {
    try {
        console.log(`Testing connection to ${RPC_URL}...`);
        const response = await axios.post(
            RPC_URL,
            {
                jsonrpc: '1.0',
                id: 1,
                method: 'getblockchaininfo',
                params: [],
            },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 5000 // 5s timeout
            }
        );
        console.log('Success!');
        console.log('Full Response:', JSON.stringify(response.data, null, 2));
    } catch (error: any) {
        console.error('Connection Failed:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        } else {
            console.error(error.message);
        }
    }
}

testRpc();
