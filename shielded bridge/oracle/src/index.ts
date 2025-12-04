import { ZcashRPC } from './rpc';
import { MinaUpdater } from './update';
import { CONFIG } from './config';

async function main() {
    console.log("Starting Oracle Service...");

    const rpc = new ZcashRPC();
    const mina = new MinaUpdater();

    // Compile contract once
    await mina.compile();

    let lastProcessedHeight = 0;

    const poll = async () => {
        try {
            // 1. Get latest height
            const currentHeight = await rpc.getBlockCount();
            const targetHeight = currentHeight - CONFIG.CONFIRMATIONS;

            if (targetHeight <= lastProcessedHeight) {
                console.log(`Waiting for new blocks... (Current: ${currentHeight}, Target: ${targetHeight})`);
                return;
            }

            console.log(`New target height: ${targetHeight}`);

            // 2. Fetch Anchor
            const anchor = await rpc.getOrchardAnchor(targetHeight);
            if (!anchor) {
                console.log(`No Orchard anchor found at height ${targetHeight}`);
                // Move forward anyway? Or retry? 
                // If no orchard tx in block, root might be same as previous.
                // Zcash blocks always have a root in the header? 
                // Yes, orchard_tree field exists if Orchard is active.
                // If null, maybe Orchard not active or RPC issue.
                return;
            }

            // 3. Check if update needed
            const currentMinaAnchor = await mina.getCurrentAnchor();
            const newAnchorField = BigInt('0x' + anchor);

            if (currentMinaAnchor.toBigInt() === newAnchorField) {
                console.log(`Anchor already up to date on Mina.`);
                lastProcessedHeight = targetHeight;
                return;
            }

            // 4. Update Mina
            console.log(`Updating Mina with new anchor: ${anchor}`);
            await mina.updateAnchor(anchor);

            lastProcessedHeight = targetHeight;

        } catch (e) {
            console.error("Error in poll loop:", e);
        }
    };

    // Initial run
    await poll();

    // Loop
    setInterval(poll, CONFIG.POLL_INTERVAL_MS);
}

main().catch(console.error);
