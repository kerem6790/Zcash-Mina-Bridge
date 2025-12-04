import { Mina, PublicKey, Field, fetchAccount } from 'o1js';
import { BridgeContract } from 'zk-app';

export class MinaClient {
    private zkApp: BridgeContract;

    constructor(rpcUrl: string, zkAppAddress: string) {
        const Network = Mina.Network(rpcUrl);
        Mina.setActiveInstance(Network);
        this.zkApp = new BridgeContract(PublicKey.fromBase58(zkAppAddress));
    }

    async getOnChainRoot(): Promise<Field> {
        try {
            await fetchAccount({ publicKey: this.zkApp.address });
            return this.zkApp.usedBridgeNullifiersRoot.get();
        } catch (e) {
            console.error("Failed to fetch on-chain root:", e);
            return Field(0);
        }
    }
}
