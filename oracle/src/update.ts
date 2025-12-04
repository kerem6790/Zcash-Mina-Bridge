import { Mina, PrivateKey, PublicKey, Field, fetchAccount } from 'o1js';
import { BridgeContract } from './BridgeContract.js';
import { CONFIG } from './config';

export class MinaUpdater {
    private zkApp: BridgeContract;
    private deployerKey: PrivateKey;

    constructor() {
        const Network = Mina.Network(CONFIG.MINA_RPC_URL);
        Mina.setActiveInstance(Network);

        this.deployerKey = PrivateKey.fromBase58(CONFIG.ORACLE_PRIVATE_KEY);
        const zkAppAddress = PublicKey.fromBase58(CONFIG.ZKAPP_ADDRESS);
        this.zkApp = new BridgeContract(zkAppAddress);
    }

    async compile() {
        console.log("Compiling BridgeContract...");
        await BridgeContract.compile();
    }

    async getCurrentAnchor(): Promise<Field> {
        try {
            // Fetch account state
            // await this.zkApp.fetchEvents(); // Events not defined yet
            // In o1js, we need to fetch the account to get the state
            await fetchAccount({ publicKey: this.zkApp.address });
            return this.zkApp.oracleAnchorRoot.get();
        } catch (e) {
            console.error("Failed to fetch current anchor:", e);
            return Field(0);
        }
    }

    async updateAnchor(anchorHex: string) {
        const anchor = Field(BigInt('0x' + anchorHex));

        console.log(`Updating Mina with new anchor: ${anchor.toString()}`);

        // Fetch account to ensure we have the latest state for witness generation
        await fetchAccount({ publicKey: this.zkApp.address });

        const tx = await Mina.transaction({ sender: this.deployerKey.toPublicKey(), fee: 100_000_000 }, async () => {
            await this.zkApp.adminUpdateAnchor(anchor);
        });

        await tx.prove();
        const sentTx = await tx.sign([this.deployerKey]).send();

        console.log(`Update transaction sent: ${sentTx.hash}`);
        return sentTx.hash;
    }
}
