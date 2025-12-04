import { MinaBridgeExportV1 } from './types';

export function parseMinaBridgeExport(json: string): MinaBridgeExportV1 {
    try {
        const data = JSON.parse(json);

        // Basic validation
        if (data.version !== 1) {
            throw new Error("Unsupported version: " + data.version);
        }
        if (data.network !== "testnet" && data.network !== "mainnet") {
            throw new Error("Invalid network: " + data.network);
        }
        if (!data.orchard) {
            throw new Error("Missing orchard data");
        }

        // Check required orchard fields
        const requiredFields = ['pk_d_receiver', 'value', 'rseed', 'rho', 'cm', 'anchor', 'merklePath', 'position', 'nf'];
        for (const field of requiredFields) {
            if (data.orchard[field] === undefined) {
                throw new Error(`Missing required field in orchard data: ${field}`);
            }
        }

        return data as MinaBridgeExportV1;
    } catch (e: any) {
        throw new Error("Failed to parse MinaBridgeExport JSON: " + e.message);
    }
}
