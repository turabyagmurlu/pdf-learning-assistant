import json
from app.ai.factory import get_llm
from app.ai.schemas import DOCUMENT_ANALYSIS_SCHEMA, STUDY_ITEMS_SCHEMA, GLOSSARY_SCHEMA, TIMELINE_SCHEMA, RELATIONS_SCHEMA
from app.config import settings


def extract_relations(context: str, doc_title: str, terms: list[str], max_relations: int = 40) -> list[dict]:
    """Sozluk maddeleri arasindaki iliskileri cikarir (kavram haritasi kenarlari)."""
    llm = get_llm()
    term_list = "\n".join(f"- {t}" for t in terms[:60])
    messages = [
        {"role": "system", "content":
            "Sen bir tarih editörüsün. Verilen metinde, aşağıdaki MADDELER arasındaki somut ilişkileri çıkarırsın. "
            "Yalnızca Türkçe yaz.\n\n"
            "KURALLAR:\n"
            "1. source ve target listedeki maddelerden BİREBİR aynı yazımla seçilir; listede olmayan ad kullanma.\n"
            "2. label: 1-3 kelimelik ilişki adı, source → target yönünde okunur. Örnekler: 'komuta etti', 'imzaladı', "
            "'karşı savaştı', 'mektup yazdı', 'yasakladı', 'kurdu', 'katıldı', 'ziyaret etti', 'kaybedildi', 'amcası'.\n"
            "3. sentence: ilişkiyi metne dayanarak anlatan 1 cümle (kaynağa sadık, uydurma yok).\n"
            "4. page: cümlenin geçtiği sayfa ([s.N]); bilinmiyorsa 0.\n"
            "5. Aynı çifti tek kez yaz; zayıf/çıkarımsal bağları atla, metinde açıkça geçenleri al.\n"
            f"6. En fazla {max_relations} ilişki. Yabancı kelime yok."},
        {"role": "user", "content": f"BELGE: {doc_title}\n\nMADDELER:\n{term_list}\n\nMETİN:\n{context[:20000]}"},
    ]
    raw = llm.structured(messages, RELATIONS_SCHEMA, model=settings.active_llm_model)
    allowed = {t.strip().lower(): t for t in terms}
    out, seen = [], set()
    for r in json.loads(raw).get("relations", []):
        s = allowed.get((r.get("source") or "").strip().lower())
        t = allowed.get((r.get("target") or "").strip().lower())
        if not s or not t or s == t:
            continue
        key = (s, t, (r.get("label") or "").strip().lower())
        if key in seen:
            continue
        seen.add(key)
        pg = r.get("page")
        out.append({"source": s, "target": t, "label": (r.get("label") or "ilişkili").strip(),
                    "sentence": (r.get("sentence") or "").strip(),
                    "page": pg if isinstance(pg, int) and pg > 0 else None})
    return out


def extract_timeline(context: str, doc_title: str, max_events: int = 30) -> list[dict]:
    """Belgeden tarihli olaylari cikarir (zaman cizelgesi)."""
    llm = get_llm()
    messages = [
        {"role": "system", "content":
            "Sen bir tarih editörüsün. Verilen metinden TARİHİ BELLİ olayları çıkarırsın. Türkçe yaz.\n\n"
            "KURALLAR:\n"
            "1. Yalnızca metinde tarihi açıkça geçen ya da kesin çıkarılabilen olayları al. Tarihi belirsiz olanı atla.\n"
            "2. year zorunlu (örn. 1911). month bilinmiyorsa 0, day bilinmiyorsa 0. Hicri tarih varsa miladiye çevir.\n"
            "3. date: insan okur biçim — '12 Mart 1921', 'Ekim 1912', '1878'.\n"
            "4. title: 3-8 kelimelik olay adı (örn. 'Uşi Antlaşması imzalandı'). detail: 1-2 cümle, ne oldu ve neden önemli.\n"
            "5. kind: savas (muharebe, işgal, isyan), antlasma (antlaşma, mütareke, kararname), siyasi (kongre, seçim, "
            "hükümet, ilan), kisisel (bir kişinin atanması, gidişi, ölümü, mektubu), diger.\n"
            "6. page: olayın geçtiği sayfa ([s.N] etiketlerinden); bilinmiyorsa 0.\n"
            "7. Belgenin yayın yılı, yazarın doğumu, kaynakçadaki eser tarihleri DAHİL DEĞİL — sadece konunun olayları.\n"
            f"8. Aynı olayı tekrar yazma. En fazla {max_events} olay; önem sırasına göre değil, hepsini ver.\n"
            "9. Yalnızca Türkçe yaz; İngilizce, İspanyolca vb. hiçbir yabancı kelime kullanma. "
            "Özel adlar Türkçe yazımıyla (Sakarya Meydan Muharebesi, Ankara Antlaşması)."},
        {"role": "user", "content": f"BELGE: {doc_title}\n\n{context[:22000]}"},
    ]
    raw = llm.structured(messages, TIMELINE_SCHEMA, model=settings.active_llm_model)
    out = []
    for ev in json.loads(raw).get("events", []):
        y = ev.get("year")
        if not isinstance(y, int) or y < 100 or y > 2100:
            continue
        t = (ev.get("title") or "").strip()
        if len(t) < 3:
            continue
        m = ev.get("month") if isinstance(ev.get("month"), int) else 0
        d = ev.get("day") if isinstance(ev.get("day"), int) else 0
        out.append({
            "date": (ev.get("date") or str(y)).strip(), "year": y,
            "month": m if 0 <= m <= 12 else 0, "day": d if 0 <= d <= 31 else 0,
            "title": t, "detail": (ev.get("detail") or "").strip(),
            "kind": ev.get("kind") or "diger",
            "page": ev.get("page") if isinstance(ev.get("page"), int) and ev.get("page") > 0 else None,
        })
    return out


def extract_glossary(context: str, doc_title: str, max_items: int = 40) -> list[dict]:
    """Bir belgeden kisi / yer / olay / antlasma / kurum / kavram listesi cikarir."""
    llm = get_llm()
    messages = [
        {"role": "system", "content":
            "Sen bir tarih ve sosyal bilimler editörüsün. Verilen metinden bir öğrencinin sınav için "
            "bilmesi gereken özel adları ve kavramları çıkarırsın. Türkçe yaz, kaynağa sadık kal.\n\n"
            "KURALLAR:\n"
            "1. kind: kisi (insan), yer (şehir/bölge/ülke/cephe), olay (savaş, isyan, kongre, seçim…), "
            "antlasma (antlaşma, sözleşme, mütareke, kararname), kurum (hükümet, parti, cemiyet, ordu, "
            "gazete, meclis), kavram (ideoloji, politika, terim).\n"
            "2. term: kısa ve temiz, HER ZAMAN Türkçe adıyla (metin başka dilde olsa bile: 'Battle of "
            "Sakarya' değil 'Sakarya Meydan Muharebesi'). Örn. 'Enver Paşa', 'Ankara Antlaşması'. "
            "Unvan varsa koru. Aynı kişi için tek madde (örn. 'Nuri Paşa' ve 'Nuri Killigil Paşa' aynıysa birleştir).\n"
            "3. definition: 1-2 cümle; KİM/NE olduğu + bu metinde NEDEN önemli olduğu. "
            "'Metinde geçen', 'yazara göre' gibi ifadeler kullanma.\n"
            "4. pages: terimin geçtiği sayfa numaraları (parçalarda [s.N] etiketi var). En fazla 6 sayfa.\n"
            "5. Belgenin yazarı, yayınlandığı üniversite/dergi, kaynakçadaki eser adları ve yazarları DAHİL DEĞİL. "
            "Yalnızca konunun içindeki adlar ve kavramlar.\n"
            "6. Aynı şeyi iki kez yazma; önemsiz/tek geçen ayrıntıları atla. "
            f"En fazla {max_items} madde; önem sırasına göre.\n"
            "7. Yalnızca Türkçe yaz; hiçbir yabancı kelime kullanma."},
        {"role": "user", "content": f"BELGE: {doc_title}\n\n{context[:22000]}"},
    ]
    raw = llm.structured(messages, GLOSSARY_SCHEMA, model=settings.active_llm_model)
    items = json.loads(raw).get("items", [])
    out = []
    for it in items:
        t = (it.get("term") or "").strip()
        if len(t) < 2:
            continue
        pages = sorted({int(p) for p in (it.get("pages") or []) if isinstance(p, (int, float)) and p > 0})[:6]
        out.append({"term": t, "kind": it.get("kind") or "kavram",
                    "definition": (it.get("definition") or "").strip(), "pages": pages})
    return out


def analyze_document(full_text: str) -> dict:
    llm = get_llm()
    text = full_text[:24000]
    messages = [
        {"role": "system", "content": "Sen bir belge analiz uzmanısın. Türkçe, kaynağa sadık analiz üret."},
        {"role": "user", "content": f"Aşağıdaki belgeyi analiz et ve şemaya uygun JSON döndür:\n\n{text}"},
    ]
    raw = llm.structured(messages, DOCUMENT_ANALYSIS_SCHEMA, model=settings.active_llm_model)
    return json.loads(raw)


def cards_from_text(text: str, count: int = 2) -> list[dict]:
    """Kullanicinin PDF'te sectigi metinden flashcard uretir."""
    llm = get_llm()
    messages = [
        {"role": "system", "content": "Sen bir ogrenme materyali ureticisisin. Turkce uret, kaynaga sadik kal."},
        {"role": "user", "content": f"Asagidaki metinden {count} adet kisa soru-cevap flashcard uret. "
                                    f"type alani 'flashcard', options bos dizi olsun.\n\n{text[:4000]}"},
    ]
    raw = llm.structured(messages, STUDY_ITEMS_SCHEMA, model=settings.active_llm_model)
    return json.loads(raw).get("items", [])


def explain_page(text: str) -> str:
    """Bir PDF sayfasini sade dille anlatir (sesli okunmaya uygun duz metin)."""
    llm = get_llm()
    messages = [
        {"role": "system", "content": "Sen sabirli bir ogretmensin. Turkce, sade ve akici anlat. "
                                      "Metin sesli okunacak: baslik, madde isareti, yildiz veya "
                                      "bicimlendirme kullanma. Sadece duz cumleler yaz. 4-8 cumle."},
        {"role": "user", "content": "Asagidaki sayfayi bana anlat. Once ana fikri soyle, sonra onemli "
                                    f"noktalari acikla, gerekirse basit bir ornek ver.\n\n{text[:8000]}"},
    ]
    return llm.complete(messages, model=settings.active_llm_model)


def feynman_review(concept: str, explanation: str, context: str) -> str:
    """Kullanicinin kendi anlatimini kaynakla karsilastirir (Feynman teknigi)."""
    llm = get_llm()
    messages = [
        {"role": "system", "content":
            "Sen sabirli bir ogretmensin. Ogrenci bir kavrami kendi cumleleriyle anlatti. "
            "Gorevin: SADECE verilen kaynaklara dayanarak anlatimini degerlendirmek. "
            "Su yapida, Turkce, sicak ve cesaretlendirici yaz:\n"
            "1) DOGRU KAVRADIKLARIN: kisa madde madde.\n"
            "2) EKSIK VEYA KARISTIRDIKLARIN: nazikce, her biri icin kaynaktaki dogrusunu yaz.\n"
            "3) BUNU DA EKLESEYDIN: anlatimini tamamlayacak 1-2 onemli nokta.\n"
            "4) TEK CUMLELIK OZET: kavramin en sade hali.\n"
            "Kaynakta olmayan bilgi uydurma. Ogrenci hicbir sey bilmiyorsa bile kucuk dusurme."},
        {"role": "user", "content":
            f"Kavram: {concept}\n\nOgrencinin anlatimi:\n{explanation[:3000]}\n\n"
            f"Kaynaklar:\n{context[:9000]}"},
    ]
    return llm.complete(messages, model=settings.active_llm_model)


def lecture_script(context: str, title: str) -> str:
    """Koleksiyon icerigini sesli dinlenebilir akici bir derse cevirir."""
    llm = get_llm()
    messages = [
        {"role": "system", "content":
            "Sen bir konuyu sesli anlatan ogretmensin. Metin SESLI OKUNACAK: baslik, madde "
            "isareti, yildiz, numara veya bicimlendirme KULLANMA. Sadece duz, akici cumleler. "
            "Dinleyiciyi 'sen' diye kabul et. Once konuya kisa bir giris yap, sonra ana "
            "fikirleri birbirine baglayarak anlat, aralarda 'simdi sunu dusun' gibi kucuk "
            "duraklamalar koy, sonunda kisa bir toparlama yap. Yaklasik 900-1200 kelime."},
        {"role": "user", "content":
            f"Konu: {title}\n\nAsagidaki kaynaklardan yararlanarak dersi anlat:\n\n{context[:14000]}"},
    ]
    return llm.complete(messages, model=settings.active_llm_model)


STUDY_QUALITY_RULES = """KALİTE KURALLARI (kesin):
1. Yalnızca KONUYU öğrenmeye yarayan sorular üret: kavram tanımı, neden-sonuç, karşılaştırma,
   olay-kişi-tarih ilişkisi, süreç/aşama, bir görüşün gerekçesi, sonuç ve etkileri.
2. YASAK: belgenin kendisi hakkında üst-veri soruları — yazar adı, üniversite, dergi, yayın yılı,
   sayfa sayısı, başlık, bölüm adı, kaynakça, "makalenin amacı nedir", "metinde adı geçen ...",
   "yazara göre ..." kalıpları. Bu tür bir soru üretme; yerine içerikten başka bir nokta seç.
3. Soru TEK BAŞINA anlaşılır olmalı: "metinde", "bu makalede", "yukarıdaki", "belgede" gibi
   ifadeler kullanma. Soru, konuyu bilen birinin kaynağa bakmadan cevaplayabileceği biçimde olsun.
4. Cevap 1-2 cümle, net ve doğrulanabilir. Evet/hayır soruları üretme.
5. Her soru FARKLI bir noktayı ölçsün; aynı bilgiyi iki kez sorma. Aşağıda "mevcut sorular"
   verilmişse onlarla aynı ya da benzer soru üretme.
6. Zorluk dağılımı yaklaşık: %30 easy, %50 medium, %20 hard. hard = neden/nasıl/karşılaştır.
7. source_page: bilginin geçtiği sayfa numarası (parçalarda [s.N] etiketi var); bilinmiyorsa 0.
8. quiz: tam 4 şık, tek doğru, çeldiriciler makul ve konuyla ilgili; answer doğru şıkkın
   metniyle BİREBİR aynı olsun. flashcard/open_question: options boş dizi.
9. open_question: "Neden…?", "Nasıl…?", "… ile … arasındaki fark nedir?", "… olmasaydı ne olurdu?"
   gibi düşündüren kalıplar; cevap alanına örnek bir iyi cevap yaz.
10. Yalnızca Türkçe yaz; İngilizce ya da başka dilden tek bir kelime bile kullanma.
"""


def generate_study_items(context: str, kind: str, count: int = 8,
                         existing: list[str] | None = None,
                         topic_hint: str = "") -> list[dict]:
    llm = get_llm()
    instr = {
        "flashcard": "soru-cevap flashcard",
        "quiz": "çoktan seçmeli quiz sorusu",
        "open_question": "açık uçlu düşündürücü soru",
    }.get(kind, "flashcard")
    existing_block = ""
    if existing:
        ex = "\n".join(f"- {q}" for q in existing[:60])
        existing_block = f"\n\nMEVCUT SORULAR (bunları tekrar üretme):\n{ex}"
    hint_block = f"\n\nKONU ÖZETİ / ANAHTAR KAVRAMLAR:\n{topic_hint[:1500]}" if topic_hint else ""
    messages = [
        {"role": "system", "content": "Sen deneyimli bir öğretmensin; sınav hazırlığı için yüksek kaliteli "
                                      "öğrenme materyali üretirsin. Türkçe üret, kaynağa sadık kal.\n\n"
                                      + STUDY_QUALITY_RULES},
        {"role": "user", "content": f"Aşağıdaki içerikten tam {count} adet {instr} üret. "
                                     f"type alanı '{kind}' olsun."
                                     f"{hint_block}{existing_block}\n\nİÇERİK:\n{context[:18000]}"},
    ]
    raw = llm.structured(messages, STUDY_ITEMS_SCHEMA, model=settings.active_llm_model)
    items = json.loads(raw).get("items", [])
    # son savunma: ust-veri kokulu sorulari ele
    bad = ("üniversitenin adı", "universitenin adi", "yazarın adı", "yazar kimdir", "yazarı kimdir",
           "makalenin adı", "makalenin başlığı", "makalenin amacı", "hangi dergide", "yayın yılı",
           "yayin yili", "sayfa sayısı", "metinde adı geçen", "metinde geçen", "bu makalede",
           "bu metinde", "bu belgede", "yazara göre", "kaynakça")
    out = []
    for it in items:
        q = (it.get("question") or "").lower()
        if any(b in q for b in bad):
            continue
        out.append(it)
    return out
