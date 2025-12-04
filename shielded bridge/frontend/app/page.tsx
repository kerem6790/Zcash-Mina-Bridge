'use client';

import { useState, useEffect } from 'react';
import { MinaBridgeExportV1, parseMinaBridgeExport } from 'bridge-core';
// We will import o1js and contract dynamically to avoid SSR issues
import type { BridgeContract } from 'zk-app';
import type { ClaimProof } from 'bridge-prover';

export default function Home() {
  const [status, setStatus] = useState('Loading...');
  const [account, setAccount] = useState('');
  const [zkApp, setZkApp] = useState<any>(null);
  const [prover, setProver] = useState<any>(null);

  // Tabs: 'deposit' | 'claim'
  const [activeTab, setActiveTab] = useState<'deposit' | 'claim'>('deposit');

  // Create Intent Inputs
  const [minZec, setMinZec] = useState('100000');
  const [receiverPkD, setReceiverPkD] = useState('');
  const [lockAmount, setLockAmount] = useState('10');

  // Claim Inputs
  const [jsonExport, setJsonExport] = useState('');
  const [intentIdToClaim, setIntentIdToClaim] = useState('0');

  useEffect(() => {
    (async () => {
      setStatus('Initializing o1js...');
      const { Mina, PublicKey, Field, UInt64, UInt32, Poseidon } = await import('o1js');
      const { BridgeContract, IntentStruct } = await import('zk-app');
      const { proveClaim } = await import('bridge-prover');

      // Configure network
      const Network = Mina.Network('https://api.minascan.io/node/devnet/v1/graphql');
      Mina.setActiveInstance(Network);

      // Address of the deployed contract
      const zkAppAddressKey = process.env.NEXT_PUBLIC_ZKAPP_ADDRESS || 'B62qq8fqSDTQFkjstvJBHJvhFFo5v4rZtM2V6uHMJk4SX7aF7S9BQL7';
      const zkAppAddress = PublicKey.fromBase58(zkAppAddressKey);
      const contract = new BridgeContract(zkAppAddress);

      setZkApp({ contract, Mina, PublicKey, Field, UInt64, UInt32, Poseidon, IntentStruct, MerkleMapWitness: (await import('o1js')).MerkleMapWitness });
      setProver({ proveClaim });
      setStatus('Ready. Connect Wallet.');
    })();
  }, []);

  const connectWallet = async () => {
    if (!(window as any).mina) {
      alert('Auro wallet not found');
      return;
    }
    const accounts = await (window as any).mina.requestAccounts();
    setAccount(accounts[0]);
    setStatus('Connected: ' + accounts[0].substring(0, 6) + '...' + accounts[0].substring(accounts[0].length - 4));
  };

  const createIntent = async () => {
    if (!zkApp || !account) return;
    try {
      setStatus('Creating Intent...');
      const { contract, Mina, PublicKey, Field, UInt64, UInt32, Poseidon } = zkApp;

      // Calculate receiverHash from pk_d (Mocking hash logic as per contract)
      const receiverHash = Poseidon.hash([Field(123)]); // TODO: Real parsing of pk_d

      const minZecAmount = UInt64.from(minZec);
      const amountToLock = UInt64.from(Number(lockAmount) * 1e9);
      const deadline = UInt64.from(200000); // Fixed deadline for demo

      // Transaction
      await (window as any).mina.sendTransaction({
        transaction: async () => {
          // Witness for empty slot 0
          const keyWitness = new zkApp.MerkleMapWitness(
            new Array(255).fill(false),
            new Array(255).fill(Field(0))
          );

          await contract.createIntent(
            minZecAmount,
            receiverHash,
            UInt32.from(200000), // deadline
            amountToLock,
            keyWitness
          );
        }
      });
      setStatus('Intent Created! Wait for block...');
    } catch (e: any) {
      setStatus('Error: ' + e.message);
    }
  };

  const handleClaim = async () => {
    if (!zkApp || !prover || !account) return;
    try {
      setStatus('Fetching Witness from Indexer...');
      const { contract, Field, IntentStruct, MerkleMapWitness, UInt32 } = zkApp;
      const { proveClaim } = prover;

      // 1. Fetch Intent from Chain (Mocking the struct, but data should match creation)
      const intent = new IntentStruct({
        minaMaker: zkApp.PublicKey.fromBase58(account),
        lockedAmountMina: zkApp.UInt64.from(Number(lockAmount) * 1e9),
        minZecAmount: zkApp.UInt64.from(Number(minZec)),
        receiverHash: zkApp.Poseidon.hash([Field(123)]), // Matches createIntent
        deadlineSlot: UInt32.from(200000),
        state: Field(0)
      });

      // Calculate bridgeNullifier to query indexer
      const { parseMinaBridgeExport } = await import('bridge-core');
      const exportData = parseMinaBridgeExport(jsonExport);
      const nf = Field(BigInt('0x' + exportData.orchard.nf));
      const intentId = Field(intentIdToClaim);
      const bridgeNullifier = zkApp.Poseidon.hash([nf, intentId]);

      // 2. Get Witness from Indexer
      const indexerResponse = await fetch('http://localhost:3001/witness/bridgeNullifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bridgeNullifier: bridgeNullifier.toString() })
      });

      if (!indexerResponse.ok) throw new Error('Indexer failed');
      const indexerData = await indexerResponse.json();

      // Reconstruct MerkleMapWitness
      const nullifierWitness = new MerkleMapWitness(
        indexerData.witness.isLeft,
        indexerData.witness.siblings.map((s: string) => Field(s))
      );

      // Mock Key Witness (for Intent Map) - assuming ID 0 and it's the only one or we know the path
      // In a real app, we'd fetch this from Indexer too. 
      // For ID 0, it's just the path to leaf 0.
      const keyWitness = new MerkleMapWitness(
        new Array(255).fill(false),
        new Array(255).fill(Field(0))
      );

      setStatus('Generating Proof...');

      // Call prover
      const proofData = await proveClaim(jsonExport, intent, intentId, keyWitness, nullifierWitness);

      setStatus('Proof Generated. Sending Transaction...');

      // 3. Send Tx
      await (window as any).mina.sendTransaction({
        transaction: async () => {
          await contract.claim(
            intentId,
            intent,
            keyWitness,
            nullifierWitness,
            proofData.claimedAmount,
            proofData.receiverHash,
            proofData.anchorPublic,
            proofData.bridgeNullifier,
            proofData.cm,
            proofData.pk_d_receiver,
            proofData.value,
            proofData.rseed,
            proofData.rho,
            proofData.merklePath,
            proofData.position,
            proofData.nf
          );
        }
      });

      // 4. Update Indexer
      await fetch('http://localhost:3001/update/bridgeNullifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bridgeNullifier: bridgeNullifier.toString() })
      });

      setStatus('Claim Submitted & Indexer Updated!');
    } catch (e: any) {
      setStatus('Error: ' + e.message);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-black text-white relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-purple-900/20 via-black to-black pointer-events-none"></div>
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-purple-600/30 rounded-full blur-[128px]"></div>
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-blue-600/20 rounded-full blur-[128px]"></div>

      {/* Header */}
      <header className="absolute top-0 w-full p-6 flex justify-between items-center z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full border border-white/20 shadow-lg shadow-purple-500/20 overflow-hidden flex items-center justify-center bg-black">
            <img src="/logo.png" alt="Zcash-Mina Bridge" className="w-[160%] h-[160%] max-w-none object-cover" />
          </div>
          <span className="font-bold text-xl tracking-tight">Zcash<span className="text-purple-400">Bridge</span></span>
        </div>
        {!account ? (
          <button
            onClick={connectWallet}
            className="bg-white/10 hover:bg-white/20 border border-white/10 backdrop-blur-md px-6 py-2 rounded-full font-medium transition-all"
          >
            Connect Wallet
          </button>
        ) : (
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 px-4 py-2 rounded-full backdrop-blur-md">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span className="font-mono text-sm text-gray-300">{account}</span>
          </div>
        )}
      </header>

      {/* Main Card */}
      <div className="relative z-10 w-full max-w-md">
        <div className="bg-[#111] border border-white/10 rounded-3xl p-1 shadow-2xl backdrop-blur-xl">

          {/* Tabs */}
          <div className="flex p-1 bg-black/40 rounded-2xl mb-4">
            <button
              onClick={() => setActiveTab('deposit')}
              className={`flex-1 py-3 rounded-xl font-medium transition-all ${activeTab === 'deposit' ? 'bg-gray-800 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
            >
              Deposit (Mina)
            </button>
            <button
              onClick={() => setActiveTab('claim')}
              className={`flex-1 py-3 rounded-xl font-medium transition-all ${activeTab === 'claim' ? 'bg-gray-800 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
            >
              Claim (ZEC)
            </button>
          </div>

          <div className="p-4 space-y-4">
            {activeTab === 'deposit' ? (
              /* Deposit / Create Intent View */
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="bg-[#1A1A1A] p-4 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                  <div className="flex justify-between mb-2">
                    <label className="text-gray-400 text-sm">You Lock</label>
                    <span className="text-gray-500 text-xs">Balance: --</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <input
                      type="text"
                      value={lockAmount}
                      onChange={e => setLockAmount(e.target.value)}
                      className="bg-transparent text-3xl font-medium focus:outline-none w-full placeholder-gray-600"
                      placeholder="0.0"
                    />
                    <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-full border border-white/10">
                      <div className="w-5 h-5 bg-orange-400 rounded-full"></div>
                      <span className="font-bold">MINA</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-center -my-2 relative z-10">
                  <div className="bg-[#222] p-2 rounded-full border border-black">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path></svg>
                  </div>
                </div>

                <div className="bg-[#1A1A1A] p-4 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                  <div className="flex justify-between mb-2">
                    <label className="text-gray-400 text-sm">You Receive (ZEC)</label>
                  </div>
                  <div className="flex items-center gap-4">
                    <input
                      type="text"
                      value={minZec}
                      onChange={e => setMinZec(e.target.value)}
                      className="bg-transparent text-3xl font-medium focus:outline-none w-full placeholder-gray-600"
                      placeholder="0"
                    />
                    <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-full border border-white/10">
                      <div className="w-5 h-5 bg-yellow-400 rounded-full"></div>
                      <span className="font-bold">ZEC</span>
                    </div>
                  </div>
                </div>

                <div className="bg-[#1A1A1A] p-4 rounded-2xl border border-white/5">
                  <label className="text-gray-400 text-sm block mb-2">Orchard Receiver Address</label>
                  <input
                    type="text"
                    value={receiverPkD}
                    onChange={e => setReceiverPkD(e.target.value)}
                    className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-purple-500/50 transition-colors font-mono"
                    placeholder="u1..."
                  />
                </div>

                <button
                  onClick={createIntent}
                  className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold py-4 rounded-2xl shadow-lg shadow-purple-900/20 transition-all transform active:scale-[0.98]"
                >
                  Create Intent
                </button>
              </div>
            ) : (
              /* Claim View */
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="bg-[#1A1A1A] p-4 rounded-2xl border border-white/5">
                  <label className="text-gray-400 text-sm block mb-2">Intent ID</label>
                  <input
                    type="text"
                    value={intentIdToClaim}
                    onChange={e => setIntentIdToClaim(e.target.value)}
                    className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-lg font-mono focus:outline-none focus:border-green-500/50 transition-colors"
                    placeholder="0"
                  />
                </div>

                <div className="bg-[#1A1A1A] p-4 rounded-2xl border border-white/5">
                  <label className="text-gray-400 text-sm block mb-2">Zashi Export JSON</label>
                  <textarea
                    value={jsonExport}
                    onChange={e => setJsonExport(e.target.value)}
                    className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-xs font-mono h-32 focus:outline-none focus:border-green-500/50 transition-colors resize-none"
                    placeholder='{"version":1, "orchard": {...}}'
                  />
                </div>

                <button
                  onClick={handleClaim}
                  className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-bold py-4 rounded-2xl shadow-lg shadow-green-900/20 transition-all transform active:scale-[0.98]"
                >
                  Generate Proof & Claim
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Status Bar */}
        <div className="mt-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-md">
            <div className={`w-2 h-2 rounded-full ${status.includes('Error') ? 'bg-red-500' : 'bg-blue-400 animate-pulse'}`}></div>
            <span className="text-xs font-medium text-gray-400">{status}</span>
          </div>
        </div>
      </div>
    </main>
  );
}
