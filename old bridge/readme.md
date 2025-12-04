# Zcash-Mina Bridge PoC: Technical Report

## 1. Executive Summary
This project implements a **Proof of Concept (PoC)** for a trust-minimized bridge between **Zcash** and **Mina Protocol**. The bridge allows users to swap **Mina** tokens for **Zcash (ZEC)** by proving the inclusion of Zcash transactions on the Mina blockchain using Zero-Knowledge Proofs (zk-SNARKs).

**Current Status**: ✅ **Functional End-to-End**.
We have successfully demonstrated the full lifecycle: creating an intent, executing a Zcash transaction, updating the Oracle, and claiming funds on Mina using a valid ZK proof.

---

## 2. Architecture Overview

The system consists of four main components:

1.  **ZkApp (Smart Contract)**: Deployed on Mina Devnet. It manages "Intents" (swap requests) and verifies Zcash transaction proofs.
2.  **Oracle Service**: A trusted off-chain service that monitors the Zcash blockchain and updates the ZkApp with the latest **Block Header Hash** (Merkle Root of transactions).
3.  **Bridge Service (User Client)**: Generates ZK proofs (Merkle Paths) to prove that a specific Zcash transaction exists in a block known to the Oracle.
4.  **Intent System**: A simplified order book where users lock Mina, which can be claimed by anyone who provides proof of a corresponding Zcash payment.

### High-Level Flow
1.  **Maker** creates an **Intent** on Mina (locks 1000 Mina).
2.  **Taker** sees the intent and sends ZEC to the Maker on the Zcash chain.
3.  **Oracle** updates the ZkApp with the Zcash Block Header containing the Taker's transaction.
4.  **Taker** generates a Merkle Proof showing their transaction is in that block.
5.  **Taker** calls `claim()` on the ZkApp with the proof.
6.  **ZkApp** verifies the proof against the Oracle's root and releases the Mina to the Taker.

---

## 3. Technical Implementation Details

### A. The "Shadow" Merkle Tree
Zcash uses a specific Merkle Tree structure (SHA-256 based). However, Mina's ZK circuits are optimized for **Poseidon** hashing.
To bridge the two efficiently in this PoC, we implemented a **"Shadow Tree"**:
*   The **Oracle** reads real Zcash blocks.
*   It computes a *new* Merkle Tree using **Poseidon Hash** from the transaction IDs.
*   It commits the **Root of this Poseidon Tree** to the Mina ZkApp.
*   The **Circuit** verifies Merkle Paths against this Poseidon Root.

**Why?** Verifying SHA-256 inside a Mina circuit is computationally expensive. This "Shadow" approach simplifies the circuit logic while maintaining the structural integrity of the proof (trust is shifted slightly to the Oracle to compute the Poseidon tree correctly).

### B. The ZkApp (`ZecBridge.ts`)
The core logic resides in the `claim` method:
```typescript
@method async claim(intentId: Field, zcashTxData: ZcashTxData, keyWitness: MerkleMapWitness, intent: IntentStruct) {
    // 1. Verify Intent exists and is OPEN
    // 2. Verify Oracle knows the Block Header (zcashTxData.blockHeaderHash)
    // 3. Verify Merkle Proof:
    //    computedRoot(txid, path, index) == zcashTxData.merkleRoot
    // 4. Payout Mina to the sender
}
```

### C. Oracle Service (`oracle_service.ts`)
*   Connects to a Zcash Node (via RPC).
*   Fetches the block containing the relevant transaction.
*   Constructs the Poseidon Merkle Tree locally.
*   Sends a transaction to the ZkApp to update `oracleBlockHeaderHash`.

---

## 4. E2E Test Walkthrough (Success Story)

We executed a full test on **Mina Devnet**:

1.  **Intent Creation**:
    *   Intent ID: `2`
    *   Amount: `1000` Mina
    *   Status: `OPEN`

2.  **Zcash Transaction**:
    *   Simulated a transfer with TxID: `c212...`
    *   Included in Zcash Block Hash: `00069...`

3.  **Oracle Update**:
    *   We pointed the Oracle to Block `00069...`.
    *   Oracle updated the ZkApp with Root: `147...`.

4.  **Claim**:
    *   We ran the `claim` script.
    *   It constructed a Merkle Path for Tx `c212...`.
    *   It proved that `c212...` is a leaf in the tree with Root `147...`.
    *   **Result**: `Claim Successful!` 🎉

---

## 5. Challenges & Solutions

### Merkle Root Mismatch
**Issue**: The Oracle was updating with the *latest* Zcash tip, but our test transaction was in an *older* block. This caused the ZkApp to reject the proof (`802... != 147...`).
**Solution**: We modified `oracle_service.ts` to accept a specific Block Hash argument, allowing us to synchronize the Oracle with the exact block containing our transaction.

### Oracle Synchronization
**Issue**: The `claim` command was running before the Oracle update transaction was included in a block.
**Solution**: We added `await tx.wait()` in the Oracle service to ensure the state was committed on-chain before proceeding.

---

## 6. Future Roadmap

### 🛡️ Security: Front-Running Protection
**Current Risk**: Anyone observing the Zcash transaction can call `claim` on Mina.
**Solution**: Implement **Address Binding**.
*   The Zcash transaction MUST include the intended Mina recipient address in the `Memo` field.
*   The ZkApp will verify that `Mina.sender` matches the address in the `Memo`.

### 🔗 Decentralized Oracle
**Current State**: Single trusted Oracle key.
**Solution**: Use a **Multi-Signature (MPC)** Oracle network or a **Light Client** approach where the ZkApp verifies Zcash Block Headers (PoW) directly inside the circuit (using a SHA-256 gadget).

### ⚡ Minimal Zcash Light Client (Header Continuity Check)
**Current Risk**: The Oracle could potentially feed an invalid block header that isn't part of the canonical chain.
**Solution**: Enhance the Oracle to commit `prevHash` along with `blockHeaderHash` and `height`.
*   The ZkApp can verify that `currentBlock.prevHash == storedBlock.hash`.
*   This enforces **Chain Continuity**, ensuring the Oracle is following a valid chain history and not jumping to arbitrary blocks.

### 🚫 Nullifiers
**Current Risk**: Replay attacks (claiming the same Zcash tx twice).
**Solution**: Store a `Nullifier` (hash of the Zcash TxID) in a Merkle Map on the ZkApp. Prevent any TxID from being used more than once.

---

## 7. How to Run

1.  **Install Dependencies**: `npm install`
2.  **Configure**: Set `.env` with keys and endpoints.
3.  **Deploy**: `npm run deploy_bridge`
4.  **Run Oracle**: `npm run oracle_service <BLOCK_HASH>`
5.  **Claim**: `npm run claim <INTENT_ID> <TXID>`
