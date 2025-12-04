Tam yerinde sıkıldın oradan: “tek tx, tek intent, tek claim” modeli bir noktadan sonra hem UX hem de tasarım olarak köşeli kalıyor.

Şimdi kafayı Model 3: Aggregated Intent Settlement moduna alalım.
Hedef:
	•	Tek tek 1:1 eşleşme yok.
	•	Herkes niyetini bırakıyor, sistem toplu “clear” ediyor.
	•	UX daha smooth: “Ben MINA → ZEC istiyorum” deyip bırakıyorsun, arkada batch işliyor.

Aşağıda konsept + mimari iskelet vereceğim. Kod değil, ajana anlatacağın seviye.

⸻

1. Sorunu netleştirelim

Şu an Model 1 / 2’nin ortak problemi:
	•	Her intent bir Zcash tx ile 1:1 eşleniyor.
	•	Her fill için ayrı claim() çağrısı ve ayrı Zcash tx → gaz / friction yüksek.
	•	Asimetri: primitive aslında “ZEC’i kanıtlayan MINA alır”, kullanıcı deneyimi MINA→ZEC veya ZEC→MINA diye eğilip bükülüyor.

Senin aradığın şey:

“Herkes order/intention bıraksın, sistem belli aralıklarla
hepsini beraber netleştirsin. Eşleşmeler 1:1 olmak zorunda olmasın.”

Bu tam aggregated intent + batch settlement işi.

⸻

2. Model 3: Batch Intent Clearing (çoklu intent, tek/az sayıda claim)

2.1 Intent formatını yükseltelim

Şu an intent kabaca:
	•	makerAmountMina
	•	minZec
	•	zcashRecipientCommitment
	•	deadline

Bunu biraz daha “order” gibi düşünelim:
	•	side: "MinaToZec" / "ZecToMina"
(user neyi verip neyi almak istiyor)
	•	amountIn
	•	minAmountOut
	•	rateHint (opsiyonel, mesela “en az 1 MINA = 0.1 ZEC olsun” gibi)
	•	recipientCommitment (karşı zincirde kimin ZEC’i alacağı)
	•	deadline

Mina tarafında:
	•	MinaToZec intents → MINA lock’lanıyor.
	•	ZecToMina intents → sadece niyet, ZEC’i sonra gönderecekler.

Bu formatın olayı: sonradan bir batch’te 10 MinaToZec + 7 ZecToMina intent birlikte clear edilebilsin.

⸻

2.2 Off-chain “matcher + solver” katmanı

Burada bir batch resolver / solver ağı devreye giriyor:
	•	Zamanı pencereleyebilirsin:
	•	Her X dakikada / her N intent’te 1 batch.
	•	Matcher’ın işi:
	•	MinaToZec ve ZecToMina intent’leri listelemek.
	•	Bir çeşit “clearing” yapmak:
	•	Kim kiminle hangi kurdan eşleşiyor?
	•	Bazı büyük order’lar birkaç küçük order’la bölünebilir.
	•	Bazı ZecToMina’lar tamamen fill olmayabilir → partial fill.
	•	Solver’ın işi:
	•	Çıkan net ZEC akışını Zcash tarafında tek veya az sayıda tx ile gerçekleştirmek.
	•	O tx’leri outputs olarak intent’lere maplemek.
	•	Sonra Mina’ya “bu batch şuna göre clear edildi” diye tek settleBatch() çağrısı yapmak.

⸻

2.3 Mina tarafında yeni method: settleBatch(batchId, batchData)

Yeni devre:

@method settleBatch(batchId: Field, batchData: BatchData) { ... }

BatchData içinde:
	•	Public benzeri inputlar:
	•	blockHeaderHash
	•	merkleRoots[] (eğer birden fazla Zcash tx kullanıldıysa)
	•	batchHash (intent + assignment’ların bir hash’i)
	•	Witness:
	•	Zcash tx’ler: txid_j, merklePath_j, outputs_j[]  (j = 1..k)
	•	Batch assignment:
	•	Hangi output hangi intent’i ne kadar karşılıyor?
	•	Örneğin: output #3 → intent_5’e 4 ZEC, intent_7’ye 2 ZEC paylaştırıldı.
	•	On-chain intent datası:
	•	intent_i seti (MinaToZec ve ZecToMina karışık olabilir)

Devre içinde yapılacak şey:
	1.	Her txid_j için merkle inclusion:
	•	Merkle(txid_j, merklePath_j) == merkleRoot_j
	2.	Her merkleRoot_j, batchData’daki merkleRoots[] ile uyumlu.
	3.	Her intent için:
	•	side == MinaToZec ise:
	•	Bu intent’e atanan ZEC toplamı ≥ minAmountOut mı?
	•	O zaman bu intent FILL olmuş kabul edilir.
	•	Karşılık gelen MINA, batch içinde solver’lara/diğer intent’lere dağıtılır.
	•	side == ZecToMina ise:
	•	Kullanıcının gönderdiği ZEC total’i amountIn ≥ minAmountIn mı?
	•	Ona karşılık MINA payı doğru hesaplanmış mı?
	4.	Global conservation check:
	•	Batch’teki tüm MinaToZec intent’lerin toplam MINA çıkışı =
Batch’teki tüm ZecToMina ve solver pozisyonlarının toplam MINA girişi (fee vs hariç).
	5.	En sonda:
	•	FILL olan MinaToZec intent’ler:
	•	Lock’lu MINA → solver/karşı taraf adreslerine transfer edilir.
	•	FILL olan ZecToMina intent’ler:
	•	Solve edilmiş fiyata göre MINA alırlar.
	•	Partial fill varsa:
	•	Ona göre remaining amount state’te güncellenir.

Böylece:
	•	On-chain tek bir settleBatch çağrısı ile 10–100 intent clear edebiliyorsun.
	•	Kullanıcı “eşleşmem kesin 1:1 kimle?” diye bilmiyor, bilmek zorunda da değil:
	•	Tek bildiği:
	•	MINA → ZEC için “en az şu kadar ZEC alırım” constraint’i,
	•	ZEC → MINA için “en az şu kadar MINA alırım” constraint’i.

⸻

3. UX nasıl “smooth” olur?

Birkaç güzellik:

3.1 Kullanıcı için:
	•	Sadece:
	•	“Şu kadar MINA’yı ZEC’e çevirmek istiyorum, en az şu kadar istiyorum.” → intent
	•	Sonra:
	•	Arka planda belli aralıklarla batch çalışıyor.
	•	Intenti FILL olunca:
	•	Kullanıcı Mina tarafında: “intent state = FILLED”
	•	Zcash tarafında ZEC’ini shielded/trans tx’ten zaten almış oluyor (veya solver modeliyle sadece MINA tarafını takip ediyor).

UI tarafında:
	•	“Pending / Partially Filled / Filled” stateleri.
	•	Fiyat / effective rate gösteriyorsun.
	•	1:1 kimle eşleştiği gereksiz detay, DB’de kalır.

3.2 Gas / friction tarafında:
	•	Her user için ayrı claim() yok.
	•	Tek settleBatch() → 50 kişiyi birden fill edebiliyor.
	•	Zcash tarafında da solver bir tx içinde 8–10 persone output yazabilir.

⸻

4. Trustlessness bozuluyor mu?

Güzel taraf: hayır, core güven modeli değişmek zorunda değil.

Aynı taşlar:
	•	Zcash tx → Merkle proof → header → oracleBlockHeaderHash
	•	Intent constraints → devrede assert’ler
	•	Batch assignment → devre içinde “sum of allocated ≥ minAmountOut” check’leri

Eklediğin tek şey:
	•	Off-chain matcher / solver, assignment’ları seçiyor.
	•	On-chain devre, “bu assignment protokol kurallarına uyuyor mu?” diye check ediyor.

Matcher yanlış yaparsa:
	•	Prover settleBatch()’in SNARK’ını üretemez → tx gönderemez.
	•	Yani matching mantığını da değiştirsen, devre ona göre güncellenmişse, her zaman “kurallara uygun bir matching” dayatıyorsun.

Trustless olmayan tek kısım ne kalıyor?
	•	Yine canonical Zcash header meselesi:
	•	Onu future work’te konuştuğumuz gibi MPC oracle / NiPoPoW / zk light client ile çözmen gerekiyor.
	•	Ama 1:1 vs aggregate bu trust modelini bozmuyor, sadece daha verimli/akıllı kullanıyor.

⸻

5. Privacy tarafında bonus

Aggregate, privacy’ye de yardımcı:
	•	Tek bir batch’te 20 kullanıcı, 3 solver, 5 tx →
Zincirden “kim kiminle takasladı?” net değil.
	•	Zcash tarafında shielded output + Mina’da intent hash’leri ile gidersen:
	•	Sadece global clearing görülüyor,
	•	Tekil eşleşmeler devre içinde kalıyor.

Sonraki seviye:
	•	batchHash public,
	•	İçindeki eşleşme mapping’i tamamen witness.
	•	Devre:
	•	“Bu batchHash şu intent seti & assignment’larından geliyor” diye check ediyor,
ama mapping’i açmıyor.

O zaman hem 1:1 zorunlu değil, hem kim kiminle eşleşti kimse bilmiyor.

⸻

6. Özetle yeni model:
	•	ONE-WAY, TEK INTENT, TEK CLAIM → PoC seviyesinde, rahatsız edici.
	•	MODEL 3 – Aggregated Intent Settlement:
	•	Intents = küçük cross-chain limit order’lar.
	•	Off-chain matcher + solver = clearing engine.
	•	On-chain zkApp = settlement & constraint enforcement.
	•	settleBatch() = tek proof, çok kişi.

Bu mimariyi raporda şöyle çizebilirsin:
	•	Şu anki PoC = “single-intent settlement primitive”
	•	Future work:
	•	“Intent’leri agregate eden, solver ağıyla batch settle eden,
privacy + UX + gas efficiency sağlayan Intent-Based Cross-Chain Clearing Layer.”

Yani “sarmadı” dediğin yer aslında bir sonraki katmanı çağırıyor:
tek yön trustless primitive → üzerine multi-intent, multi-solver, batch settlement katı.