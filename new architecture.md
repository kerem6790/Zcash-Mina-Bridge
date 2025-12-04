Tamam, reset attık, en son konuştuğumuz modele uygun “final boss” mimariyi çiziyorum.
(ZEC tarafı full shielded, view key yok, 3. partiye ekstra bilgi yok, prover = ZEC gönderen.)

⸻

0. Aktörler
	•	MinaSender – MINA sahibi, ZEC almak istiyor → Mina’da intent açıp MINA kilitliyor.
	•	ZECSender – ZEC sahibi, MINA almak istiyor → Zcash’ten shielded ödeme yapıp Mina’da claim eden taraf.
	•	Zcash chain (Orchard) – Shielded havuz, anchor ve nullifier seti üreten zincir.
	•	Oracle (çok hafif) – Sadece canonical Orchard anchor’ını Mina’ya yazar (veya “finalized anchor” diyelim).
	•	Mina zkApp – Intent + settlement + nullifier takibi yapan contract.

Önemli: Bridge açısından kimse Zcash node RPC’siyle uğraşmıyor.
ZECSender zaten normal bir wallet kullanıyor; wallet kendi senkronizasyonu için node/lightwalletd ile konuşur, bu bizim protokolden bağımsız.

⸻

1. On-chain Yapılar (Mina zkApp)

1.1 Intent kaydı

Her intent için Mina zkApp’te mesela şöyle bir state düşün:
	•	intentId
	•	minaMaker – MinaSender hesabı
	•	lockedAmountMina
	•	minZecAmount
	•	receiverHash – hash(pk_d_receiver)
(MinaSender’ın Zcash Orchard adresi → sadece hash on-chain)
	•	deadlineSlot
	•	state ∈ {OPEN, FILLED, CANCELLED}

1.2 Oracle state’i
	•	oracleAnchorRoot – Orchard note commitment tree root
(Oracle bunu periyodik olarak günceller; canonical chain’i temsil ediyor.)

1.3 Bridge nullifier seti (replay koruması)
	•	usedBridgeNullifiers – MerkleMap / set
	•	Eleman: bridgeNullifier = Poseidon(nf || intentId)

Böylece aynı Zcash note’u birden fazla intent’te kullanmak engelleniyor.

⸻

2. Off-chain Bilgi (Sadece ZECSender wallet’ında)

Wallet Orchard için zaten şu bilgileri tutuyor:
	•	OrchardSentOutput (bizim jokerimiz)
	•	pk_d_receiver
	•	value (gönderilen ZEC miktarı)
	•	rseed, rho vs. (note randomness)
	•	Bunlardan cm (note commitment) hesaplanabiliyor.
	•	merklePath – o note’un Orchard tree içindeki sibling hash’leri
	•	position – leaf index
	•	anchor – o pozisyona kadar oluşan Orchard root
	•	nf – o input note harcandığında üretilmiş nullifier (veya üretmek için gerekli secret’lar)

Hepsi sender’ın cüzdanında zaten var.
Node’dan ekstra “özel” veri çekmeye gerek yok; sadece normal wallet senkronu.

⸻

3. Akış

3.1 Intent oluşturma (MinaSender)
	1.	MinaSender, ZECSender’a Zcash Orchard adresini (z-addr) off-chain verir.
	2.	MinaSender Mina zkApp’e createIntent(...) çağrısı yapar:
	•	lockedAmountMina
	•	minZecAmount
	•	receiverHash = hash(pk_d_receiver)
	•	deadlineSlot
	3.	zkApp:
	•	MINA’yı escrow’a alır.
	•	Intent state’ini OPEN yapar.

On-chain görünen tek şey:
“Şu hash’e sahip bir Orchard adresine en az X ZEC gelirse, Y MINA veririm.”

Adresin kendisi yok, sadece hash’i var.

⸻

3.2 Zcash shielded ödeme (ZECSender)
	1.	ZECSender, bu receiverHash’e karşılık gelen gerçek Orchard adresini off-chain bilir.
	2.	Orchard wallet’ından shielded ödeme yapar:
	•	Input: kendi eski notları.
	•	Output: yeni Orchard note → MinaSender’ın pk_d’si + amount + randomness.
	3.	Tx block’a girince:
	•	Wallet, kendi gönderdiği output için OrchardSentOutput kaydını tutar.
	•	Tree senkronu sırasında:
	•	merklePath
	•	position
	•	anchor
zaten wallet tarafından öğrenilir ve local’e yazılır.

Bu noktada ZECSender’in elindeki local paket:

(note plaintext, cm, merklePath, anchor, nf, intentId, receiverHash, minZecAmount, …)

⸻

3.3 ZECSender tarafında Prover (local, wallet içinde)

ZECSender’in cüzdanı (veya bizim bridge SDK’mız) Mina için bir zk proof üretir.

Bu proof, Mina zkApp’in claim(intentId, publicInputs..., proof) fonksiyonuna uygun statement’ı ispatlar.

3.3.1 Circuit’in aldığı private inputs (sadece prover görüyor)
	•	OrchardSentOutput:
	•	pk_d_receiver
	•	value
	•	rseed, rho, vs.
	•	merklePath, position
	•	anchor
	•	nf veya nf’i hesaplamak için gerekli secret

3.3.2 Public inputs (Mina’da görünenler)
	•	intentId
	•	claimedAmount (örneğin tam value veya minZecAmount)
	•	receiverHash
	•	anchorPublic
	•	bridgeNullifier = Poseidon(nf || intentId)
	•	cm (gerekirse)

⸻

4. ZkApp içindeki claim() metodunun ZK statement’ı

Circuit içinde şu constraint’ler var:
	1.	Note doğruluğu (correctness)
	•	cm = Commit(pk_d_receiver, value, rseed, ...)
	•	(Orchard’daki note formatına uygun şekilde)
	2.	Adres eşleşmesi (Doğru kişiye ödeme mi?)
	•	hash(pk_d_receiver) == receiverHash
→ Mina’daki intent’teki hash’le eşleşmeli.
	3.	Amount koşulu
	•	value >= intent.minZecAmount
	4.	Inclusion (Note gerçekten canonical Orchard tree’de mi?)
	•	MerkleRoot(merklePath, position, cm) == anchorPrivate
	•	anchorPrivate == oracleAnchorRoot
(Oracle’ın Mina’ya yazdığı root ile eşit)
	5.	Nullifier & replay koruması
	•	bridgeNullifier = Poseidon(nf || intentId)
	•	zkApp state’inde bridgeNullifier daha önce kullanılmamış olmalı
(MerkleMap / set içinde membership check).
	•	Claim başarılı olursa bu bridgeNullifier set’e eklenir.
	6.	Intent ve süre kontrolü
	•	intent.state == OPEN
	•	currentSlot <= intent.deadlineSlot

Bu statement sağlanmadan Mina transaction’ı için proof üretilemez;
üretildiyse, Mina node’ları bunu verify ederek “evet, bu intent için uygun bir Orchard ödemesi yapılmış” kabul eder.

⸻

5. On-chain claim() execution (Mina)

ZECSender, wallet’ından:

claim(intentId, publicInputs..., proof)

çağrısını gönderir.

ZkApp:
	1.	Prooffu verify eder (Mina’nın native SNARK sistemi ile).
	2.	Yukarıdaki constraint’lerin hepsinin sağlandığını kabul eder.
	3.	İşlemleri yapar:
	•	lockedAmountMina → ZECSender’ın Mina adresine transfer.
	•	intent.state → FILLED
	•	bridgeNullifier → usedBridgeNullifiers set’ine eklenir.

Artık aynı Zcash note’u veya aynı (nf, intentId) ikilisini tekrar kullanmak mümkün değildir.

⸻

6. Node / Oracle / Wallet rollerinin net ayrımı
	•	Zcash node / lightwalletd
	•	Sadece normal wallet fonksiyonları için:
	•	Orchard tree senkronu
	•	merklePath, anchor güncellemesi
	•	Bridge protokolü bundan bağımsız; ayrı RPC yazmıyoruz.
	•	ZECSender wallet’ı / Bridge SDK
	•	OrchardSentOutput + merklePath + anchor + nf → local ZK prover inputu
	•	Mina zkApp’e uygun proof’u üretip transaction’ı gönderir.
	•	Oracle
	•	Sadece oracleAnchorRoot (ve opsiyonel, canonical height) yazar.
	•	Hiçbir view key almaz.
	•	Hiçbir note plaintext görmez.
	•	Gelecekte MPC / multi-sig / zk-light-client ile decentralize edilebilir.

⸻

7. Privacy & Trust Özeti
	•	Zcash tarafı:
	•	Gönderilen z-address, note plaintext, amount → sadece ZECSender & MinaSender bilir.
	•	Mina zinciri sadece receiverHash, claimedAmount, bridgeNullifier, anchor gibi türetilmiş değerleri görür.
	•	Mina tarafı:
	•	Intent ve settlement tamamen public (MINA durum gereği).
	•	ZEC tarafının gerçek adresleri / tx yapısı açığa çıkmaz.
	•	Ek trust:
	•	Sadece canonical anchor için Oracle’a güveniyoruz.
	•	Zcash notunun gerçekten var olduğunu ve doğru kişiye doğru miktarda gönderildiğini ZK ile kanıtlıyoruz.

⸻

Bu, şu ana kadar konuştuğumuz “sender tabanlı shielded bridge” modelinin tüm parçalarını uyumlu, güncel ve Zcash/Orchard spesifikasyonuyla tutarlı şekilde birleştiren son mimari.

Üstüne artık “hangi hash fonksiyonlarını, hangi circuit kütüphanesini, proof-conversion mı yoksa native Orchard gadget’ı mı” gibi implementation seviyesine inip optimize edebiliriz.