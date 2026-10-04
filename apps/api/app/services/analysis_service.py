import inspect
import json
import re
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


SUGGEST_KINDS = {
    "genel": "Genel bakış",
    "karsilastir": "Karşılaştır",
    "derinles": "Derinleş",
    "elestir": "Eleştir",
    "uygula": "Uygula",
}


def notebook_suggestions(digest: str, notebook_title: str) -> dict:
    """Defterdeki kaynaklarin OZETLERINDEN (PDF'lerin tamami degil) yonlendirici sorular uretir.
    Tek istek. Amac: kullanici her seyi okumadan defterin buyuk resmini ve derin noktalarini
    hizla kesfetsin."""
    from app.ai.schemas import SUGGESTIONS_SCHEMA
    llm = get_llm()
    messages = [
        {"role": "system", "content":
            "Sen bir araştırma asistanısın. Kullanıcının bir araştırma defteri var; aşağıda içindeki "
            "kaynakların özetleri ve anahtar kavramları duruyor. Kullanıcı kaynakların hepsini okumadan "
            "defterin büyük resmini ve derin noktalarını hızla kavramak istiyor. Ona sorulması en değerli "
            "soruları öner.\n\n"
            "KURALLAR:\n"
            "- Yalnızca Türkçe yaz.\n"
            "- 5 grup üret: genel, karsilastir, derinles, elestir, uygula. Her grupta tam 3 soru.\n"
            "  genel: defterin ana temaları, büyük resim, kaynakların ortak cevap verdiği soru.\n"
            "  karsilastir: kaynakların nerede uyuştuğu / ayrıştığı; farklı yaklaşım, yöntem, sonuç.\n"
            "  derinles: mekanizma, neden-sonuç, 'nasıl çalışır', en önemli kavramların ilişkisi.\n"
            "  elestir: kanıtın gücü, çelişkiler, eksik kalan konular, sınırlılıklar.\n"
            "  uygula: pratik sonuç, 'bu bilgiyle ne yapmalıyım', karar ve öneri.\n"
            "- Sorular BU DEFTERE özgü olsun: özetlerdeki gerçek kavramları, kişileri, konuları an. "
            "  'Bu belgenin ana fikri nedir' gibi genel ve boş sorular YASAK.\n"
            "- Her soru tek cümle, en fazla 18 kelime, doğrudan sorulabilir olsun.\n"
            "- Metadata sorusu sorma (yazar adı, yayın yılı, dergi, üniversite, sayfa sayısı).\n"
            "- 'why' alanı: bu sorunun kullanıcıya ne kazandıracağını en fazla 8 kelimeyle söyle.\n"
            "- 'theme' alanı: defterin konusunu tek cümleyle (en fazla 14 kelime) özetle."},
        {"role": "user", "content": f"Defter: {notebook_title}\n\nKaynaklar:\n{digest}"},
    ]
    raw = llm.structured(messages, SUGGESTIONS_SCHEMA, model=settings.active_llm_model)
    data = json.loads(raw)
    groups = []
    for g in data.get("groups", []):
        k = g.get("kind")
        if k not in SUGGEST_KINDS:
            continue
        qs = [{"q": (x.get("q") or "").strip(), "why": (x.get("why") or "").strip()}
              for x in g.get("questions", []) if (x.get("q") or "").strip()]
        if qs:
            groups.append({"kind": k, "label": SUGGEST_KINDS[k], "questions": qs[:4]})
    order = list(SUGGEST_KINDS)
    groups.sort(key=lambda g: order.index(g["kind"]))
    return {"theme": (data.get("theme") or "").strip(), "groups": groups}


def template_suggestions(concepts: list[str], titles: list[str]) -> dict:
    """Kota yoksa: yapay zekasiz, kavram listesinden sablon sorular. Bos ekran kalmasin."""
    c = [x for x in concepts if x][:6] or ["ana konu"]
    a, b = c[0], (c[1] if len(c) > 1 else c[0])
    d = c[2] if len(c) > 2 else a
    groups = [
        {"kind": "genel", "label": SUGGEST_KINDS["genel"], "questions": [
            {"q": "Bu defterdeki kaynaklar ortak olarak hangi soruya cevap arıyor?", "why": "Büyük resmi tek cümlede gör"},
            {"q": f"{a} konusunda kaynakların vardığı ana sonuçlar neler?", "why": "Temel bulguları hızla topla"},
            {"q": "Bu defteri okumaya hangi kaynaktan başlamalıyım, neden?", "why": "Okuma sırasını belirle"},
        ]},
        {"kind": "karsilastir", "label": SUGGEST_KINDS["karsilastir"], "questions": [
            {"q": f"Kaynaklar {a} hakkında nerede uyuşuyor, nerede ayrışıyor?", "why": "Görüş farklarını yakala"},
            {"q": "Kaynaklar hangi yöntemleri kullanmış ve sonuçları nasıl farklılaşıyor?", "why": "Yöntem etkisini gör"},
        ]},
        {"kind": "derinles", "label": SUGGEST_KINDS["derinles"], "questions": [
            {"q": f"{a} ile {b} arasındaki ilişki nasıl açıklanıyor?", "why": "Kavramları birbirine bağla"},
            {"q": f"{d} nasıl işliyor; mekanizmayı adım adım anlat.", "why": "Nedenini anla"},
        ]},
        {"kind": "elestir", "label": SUGGEST_KINDS["elestir"], "questions": [
            {"q": "Kaynaklardaki en zayıf kanıt ya da en tartışmalı iddia hangisi?", "why": "Güvenilirliği tart"},
            {"q": "Bu kaynakların cevapsız bıraktığı önemli sorular neler?", "why": "Araştırma boşluğunu bul"},
        ]},
        {"kind": "uygula", "label": SUGGEST_KINDS["uygula"], "questions": [
            {"q": f"{a} konusunda kaynaklara göre pratikte ne yapılmalı?", "why": "Bilgiyi eyleme çevir"},
            {"q": "Bu kaynaklardan çıkan en önemli 5 öneriyi sırala.", "why": "Özeti uygulanabilir yap"},
        ]},
    ]
    return {"theme": "", "groups": groups}


# ---- Belge analizi (L0 + L1) ---------------------------------------------------------

ANALYSIS_SAMPLE_CHARS = 40000      # bas-orta-son dengeli ornek (eskiden: ilk 24K karakter)


def sample_pages(pages: list[dict], budget: int = ANALYSIS_SAMPLE_CHARS,
                 head: float = 0.35, tail: float = 0.30) -> str:
    """Belgenin basi, ortasi ve sonundan dengeli ornek alir; her sayfa `[s.N]` etiketiyle baslar.

    - Toplam metin butceye sigiyorsa hepsi (etiketli) doner.
    - Sigmiyorsa: bastan `head`, sondan `tail` payi ardisik sayfalarla doldurulur; kalan pay
      ortadaki sayfalardan esit aralikla secilir (sozlukteki `_glossary_context` kalibi).
    Boylece uzun bir tezin sonuc/tartisma bolumu de modele gider (T5-ozet §3.2).
    Girdi: [{"page_number": n, "text": "..."}] ya da [{"page": n, "text": ...}].
    """
    items = []
    for i, p in enumerate(pages or []):
        t = (p.get("text") or "").strip()
        if not t:
            continue
        n = p.get("page_number") or p.get("page") or (i + 1)
        items.append((int(n), t))
    if not items:
        return ""
    tag = lambda n, t: f"[s.{n}] {t}"  # noqa: E731
    total = sum(len(t) + 8 for _, t in items)
    if total <= budget:
        return "\n\n".join(tag(n, t) for n, t in items)

    def take(seq, limit):
        out, used = [], 0
        for n, t in seq:
            room = limit - used
            if room <= 0:
                break
            if len(t) > room:
                t = t[:max(0, room - 1)].rsplit(" ", 1)[0] + "…"
            out.append((n, t))
            used += len(t) + 8
        return out

    head_b, tail_b = int(budget * head), int(budget * tail)
    mid_b = budget - head_b - tail_b
    head_part = take(items, head_b)
    tail_src = list(reversed(items[len(head_part):]))
    tail_part = list(reversed(take(tail_src, tail_b)))
    lo, hi = len(head_part), len(items) - len(tail_part)
    middle = items[lo:hi]
    mid_part: list[tuple[int, str]] = []
    if middle and mid_b > 0:
        # esit aralikli sayfa secimi; her sayfadan en fazla ~1.2K karakter
        per = max(600, min(1200, mid_b // 8))
        k = max(1, min(len(middle), mid_b // per))
        step = len(middle) / k
        for i in range(k):
            n, t = middle[int(i * step)]
            if len(t) > per:
                t = t[:per - 1].rsplit(" ", 1)[0] + "…"
            mid_part.append((n, t))
    parts = head_part + mid_part + tail_part
    return "\n\n".join(tag(n, t) for n, t in parts)


def _pages_from_text(full_text: str) -> list[dict]:
    """Sayfa bilgisi olmayan duz metni ~3K karakterlik sanal sayfalara boler (etiketler yine [s.N])."""
    out, i, n = [], 0, 1
    while i < len(full_text):
        out.append({"page_number": n, "text": full_text[i:i + 3000]})
        i += 3000
        n += 1
    return out


ANALYSIS_RULES = (
    "Sen bir öğrenme tasarımcısısın; lisans mezunu, meraklı bir yetişkin öğrenen için kaynağı tanıtıyorsun. "
    "Yalnızca Türkçe yaz (özgün ad gerekirse parantez içinde). Kaynağa sadık kal; uydurma. "
    "Metadata değil İÇERİK anlat: yazar adı, üniversite, dergi, yayın yılı, sayfa sayısı özetlerin gövdesine girmez.\n\n"
    "ALANLAR (uzunluklar kesin):\n"
    "- short_summary: tek cümle, en fazla 30 kelime; kaynağın ana iddiasını/konusunu söyler. Markdown kullanılabilir (**kalın**).\n"
    "- detailed_summary: 150-250 kelime, Markdown. 2-3 paragraf: (1) kaynak neyi, hangi soruya cevap olarak anlatıyor; "
    "(2) ana fikirler ve bunların nasıl bağlandığı; (3) okuyanın eline ne geçer. Başlık koyma, madde kullanma.\n"
    "- learn_goals: 3-5 madde; her biri 'Bu kaynağı okuyunca …' kalıbında değil, doğrudan fiille başlayan tam cümle "
    "(örn. 'Kreatin yüklemesinin kas performansını hangi mekanizmayla etkilediğini açıklayabilirsin.'). En fazla 22 kelime.\n"
    "- purpose: 1-2 cümle; kaynağın amacı / hangi boşluğu doldurduğu.\n"
    "- difficulty_level: beginner (ön bilgi gerekmez), intermediate (temel alan bilgisi gerekir), advanced (uzmanlık/istatistik/ileri kavram).\n"
    "- outline: kaynağın gerçek bölüm başlıkları sırayla (varsa metindeki başlıklar; yoksa içerikten 5-10 bölüm adı).\n"
    "- key_concepts: 6-12 kavram; term kısa, definition 1-2 cümle (kaynağın bu kavramı nasıl kullandığı).\n"
    "- difficult_concepts: 3-6 madde; biçim 'Kavram — neden zor olduğu (en fazla 12 kelime)'. "
    "Örn. 'Etki büyüklüğü — farklı ölçekleri tek sayıya indirir, yorumu sezgisel değil'.\n"
    "Metin parçaları [s.N] sayfa etiketleriyle gelir; belgenin başı, ortası ve sonu birlikte verilmiştir, hepsini dikkate al."
)


def analyze_document(full_text: str, pages: list[dict] | None = None) -> dict:
    """Belge analizi (isleme hattinda bir kez). Girdi: bas-orta-son dengeli ~40K karakter.
    `pages` verilirse gercek sayfa etiketleri kullanilir; yoksa duz metin sanal sayfalara bolunur."""
    llm = get_llm()
    text = sample_pages(pages or _pages_from_text(full_text or ""))
    messages = [
        {"role": "system", "content": ANALYSIS_RULES},
        {"role": "user", "content": f"Aşağıdaki kaynağı analiz et ve şemaya uygun JSON döndür:\n\n{text}"},
    ]
    raw = _structured(llm, messages, DOCUMENT_ANALYSIS_SCHEMA, temperature=0.3, max_output_tokens=4096)
    data = json.loads(raw)
    goals = [str(g).strip() for g in (data.get("learn_goals") or []) if str(g).strip()]
    data["learn_goals"] = goals[:5]
    data["difficult_concepts"] = [str(x).strip() for x in (data.get("difficult_concepts") or []) if str(x).strip()][:6]
    return data


def _structured(llm, messages, schema, **kw) -> str:
    """Saglayici temperature/max_output_tokens parametresini tanimiyorsa eski imzayla cagir."""
    try:
        return llm.structured(messages, schema, model=settings.active_llm_model, **kw)
    except TypeError:
        return llm.structured(messages, schema, model=settings.active_llm_model)


def _complete(llm, messages, **kw) -> str:
    try:
        return llm.complete(messages, model=settings.active_llm_model, **kw)
    except TypeError:
        return llm.complete(messages, model=settings.active_llm_model)


DIFFICULTY_TR = {"beginner": "giriş", "intermediate": "orta", "advanced": "ileri"}


def difficulty_tr(level: str | None) -> str | None:
    return DIFFICULTY_TR.get((level or "").strip().lower()) if level else None


def reading_minutes(token_total: int | None, media: dict | None = None) -> int | None:
    """Okuma suresi (dk): toplam token / 1.3 ≈ kelime, 220 kelime/dk. Video/ses: media.duration."""
    dur = (media or {}).get("duration") if isinstance(media, dict) else None
    if isinstance(dur, (int, float)) and dur > 0:
        return max(1, int(round(dur / 60)))
    if not token_total or token_total <= 0:
        return None
    words = token_total / 1.3
    return max(1, int(round(words / 220)))


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
    """Bir PDF sayfasini dinlenecek sekilde anlatir (duz metin; TTS ve cumle vurgusu ayni metni kullanir).

    Dinlenebilir anlatim kurallari (_SPOKEN_RULES) + sicaklik 0.8: makale ozeti degil, ogretmen anlatimi."""
    llm = get_llm()
    messages = [
        {"role": "system", "content":
            "Sen sabırlı, sıcak bir öğretmensin; bir öğrenciye bir sayfayı sesli anlatıyorsun. "
            "Türkçe, sade ve akıcı konuş. Uzunluk: 60–90 saniyede dinlenecek kadar (120–170 kelime), "
            "2–3 kısa paragraf. Önce sayfanın asıl derdini tek cümleyle söyle, sonra önemli noktaları "
            "birbirine bağlayarak anlat, gerekirse günlük hayattan basit bir örnek ver, sonda en önemli "
            "cümleyi farklı sözcüklerle tekrar et.\n\n" + _SPOKEN_RULES},
        {"role": "user", "content": "Aşağıdaki sayfayı bana anlat.\n\n" + text[:8000]},
    ]
    return llm.complete(messages, model=settings.active_llm_model, **warm_kwargs(llm.complete))


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


_SPOKEN_RULES = (
    "Bu metin YALNIZCA KULAKLA dinlenecek; dinleyici hiçbir şey görmüyor. Kurallar:\n"
    "(1) Birinci tekil anlatıcı ol (\"şimdi sana şunu anlatacağım\"), dinleyiciye \"sen\" de.\n"
    "(2) Cümleler kısa: en fazla 15–18 kelime; her cümle tek fikir.\n"
    "(3) Her bölümün başında ne anlatacağını bir cümleyle söyle; sonunda en önemli cümleyi farklı "
    "sözcüklerle tekrar et.\n"
    "(4) Geçişlerde konuşma bağlayıcıları kullan: \"Peki bu ne demek?\", \"Şimdi ikinci noktaya geçelim\", "
    "\"Buraya kadar özetlersek\".\n"
    "(5) Rakam yazma; tüm sayıları, yılları, yüzdeleri ve sıra sayılarını yazıyla yaz "
    "(\"bin dokuz yüz yirmi üç\", \"yüzde on iki\", \"birinci\").\n"
    "(6) Hiçbir kısaltma kullanma (vb., yy., M.Ö., Dr. gibi kısaltmaları açık yaz).\n"
    "(7) Parantez, tire, iki nokta, tırnak, madde işareti, başlık, numaralandırma kullanma; parantez "
    "yerine ayrı cümle kur.\n"
    "(8) Kaynak, yazar adı, yıl atıfı, sayfa, şekil, tablo, dipnot referansı verme; \"Şekil üçte\" gibi "
    "görsel atıfları tamamen çıkar, içeriği sözle anlat.\n"
    "(9) Yabancı ya da Latince bir terimi ilk geçtiğinde Türkçe okunuşuyla ve bir kelimelik "
    "açıklamayla ver (\"mitokondri, yani hücrenin enerji santrali\").\n"
    "(10) Yazı dili kalıpları yasak: \"bu bağlamda\", \"söz konusu\", \"ele alınmaktadır\" ve "
    "\"-mektedir\" edilgen zinciri; konuşur gibi yaz (\"burada şunu görüyoruz\").\n"
    "(11) Noktalama ile nefes ver: önemli cümleden önce ve sonra kısa bir cümle; her paragraf 3–5 cümle; "
    "paragraflar arasında boş satır. Yalnızca Türkçe yaz."
)


def warm_kwargs(fn) -> dict:
    """Anlatim/sohbet cagrilarinda sicaklik 0.8 (duz-liste tonunun en buyuk nedeni 0.2'ydi).

    Saglayici `temperature` parametresini destekliyorsa gecirir; desteklemiyorsa bos sozluk
    (eski saglayici imzasiyla da calisir). Yapisal JSON cagrilari 0.2'de kalir."""
    try:
        return {"temperature": 0.8} if "temperature" in inspect.signature(fn).parameters else {}
    except (TypeError, ValueError):
        return {}


def lecture_prompt(context: str, title: str, dialog: bool = False) -> list[dict]:
    """Sesli ozet istemi. dialog=True: iki kisilik sohbet (Ayse ogretmen, Kerem merakli ogrenci).

    Sohbet biciminde her replik ayri satirda 'Ayşe: …' / 'Kerem: …' olarak yazilir;
    seslendirme bu etiketlere gore iki ayri sesle yapilir. Kurallar Turkce karakterli (T6).
    """
    if dialog:
        system = (
            "Sen bir podcast senaristisin. İki kişi konuyu sohbet ederek anlatır: "
            "Ayşe (sakin, sıcak bir öğretmen; anlatır ve örnek verir) ve "
            "Kerem (meraklı bir öğrenci; kısa sorular sorar, anladığını kendi cümleleriyle "
            "tekrar eder, bazen şaşırır). BİÇİM KESİN: her replik ayrı satırda, satır 'Ayşe: ' "
            "ya da 'Kerem: ' ile başlar; başka konuşmacı, sahne yönergesi, başlık yok. "
            "Replikler kısa (1–3 cümle), sıralı ve doğal; Kerem'in soruları dinleyicinin "
            "aklına gelecek sorular olsun. Kerem giriş yapar ve konuyu sorar, Ayşe anlatır. "
            "Ayşe her yeni alt konudan önce 'Şimdi …' diye başlasın; Kerem her 3–4 replikte "
            "anlaşılanı bir cümleyle tekrar etsin; sonda Kerem öğrendiklerini iki cümleyle toparlar. "
            "Yaklaşık 900–1200 kelime.\n\n" + _SPOKEN_RULES
        )
        user = f"Konu: {title}\n\nAşağıdaki kaynaklardan yararlanarak sohbeti yaz:\n\n{context[:14000]}"
    else:
        system = (
            "Sen bir konuyu sesli anlatan öğretmensin. Sadece düz, akıcı cümleler. "
            "Dinleyiciyi 'sen' diye kabul et. Önce konuya kısa bir giriş yap, sonra ana "
            "fikirleri birbirine bağlayarak anlat, aralarda 'şimdi şunu düşün' gibi küçük "
            "duraklamalar koy, sonunda kısa bir toparlama yap. Kaynakça, başlık sayfası, "
            "içindekiler ve yazar bilgisi gibi kısımları anlatma; konunun kendisini anlat. "
            "Paragraflar arasında boş satır bırak. Yaklaşık 900–1200 kelime.\n\n" + _SPOKEN_RULES
        )
        user = f"Konu: {title}\n\nAşağıdaki kaynaklardan yararlanarak dersi anlat:\n\n{context[:14000]}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def lecture_script(context: str, title: str, dialog: bool = False) -> str:
    """Koleksiyon icerigini sesli dinlenebilir akici bir derse (ya da iki kisilik sohbete) cevirir (sicaklik 0.8)."""
    llm = get_llm()
    return llm.complete(lecture_prompt(context, title, dialog), model=settings.active_llm_model,
                        **warm_kwargs(llm.complete))


def spoken_score(text: str) -> dict:
    """Dinlenebilirlik olcumu (kota 0; T5 4.1): cumle uzunlugu, rakam/kisaltma/edilgen sayisi, hitap isaretleri."""
    words = text.split()
    sents = [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s.strip()]
    lens = [len(s.split()) for s in sents] or [0]
    n_words = max(1, len(words))
    return {
        "words": len(words),
        "sentences": len(sents),
        "avg_sentence_words": round(sum(lens) / len(lens), 1),
        "long_sentence_ratio": round(sum(1 for n in lens if n > 20) / max(1, len(lens)), 2),
        "digits": len(re.findall(r"\d", text)),
        "abbreviations": len(re.findall(r"\b(?:vb|vs|yy|bkz|örn|M\.Ö|M\.S|Dr|Prof)\.", text)),
        "passive_per_100": round(100 * len(re.findall(r"\b\w+(?:mektedir|maktadır|mıştır|miştir|muştur|müştür)\b", text)) / n_words, 2),
        "address_per_100": round(100 * len(re.findall(r"\b(?:sana|sen|şimdi|bak|peki|düşün|hatırla)\b", text, re.IGNORECASE)) / n_words, 2),
        "paragraphs": len([p for p in re.split(r"\n\s*\n", text) if p.strip()]),
        "punct_marks": len(re.findall(r"[()\[\]:—–\"“”]", text)),
    }


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


# =====================================================================================
# Çalışma notu (L2 ders notu, defter sentez notu, "Kendi sözlerinle anlat" geri bildirimi)
# T5-ozet §3.1-3.4, SPEC-v3 "Çalışma notu". Uçlar: app/api/study_notes.py
# =====================================================================================

STUDY_NOTE_VERSION = "sn1"          # istem/şema değişince artır → önbellek anahtarı değişir
STUDY_SINGLE_CALL_CHARS = 48000     # bu kadar karaktere kadar tek istek (⚡1); üstü map+reduce (⚡2)
STUDY_MAP_BUDGET_CHARS = 90000      # map adımına giden toplam örnek
STUDY_MAX_SECTIONS = 16
STUDY_MIN_SECTION_CHARS = 1500

_PAGE_TAG_RE = re.compile(r"\[s\.\s*\d+(?:\s*[-–]\s*\d+)?\]")


def study_note_plan(total_chars: int) -> dict:
    """Kaç istek gerekir? Rozet (⚡1 / ⚡2) bu sayıyı gösterir."""
    if total_chars <= STUDY_SINGLE_CALL_CHARS:
        return {"calls": 1, "mode": "single"}
    return {"calls": 2, "mode": "map_reduce"}


def _target_words(total_chars: int) -> tuple[int, int]:
    """Belge kısaysa not da kısa (şişirme yok): <12K → 300-600, <40K → 600-1200, üstü 1200-2000."""
    if total_chars < 12000:
        return 300, 600
    if total_chars < 40000:
        return 600, 1200
    return 1200, 2000


def build_sections(chunks: list[dict]) -> list[dict]:
    """document_chunks satırlarından bölümler: section_title'a göre gruplar; başlık yoksa ~12K karakterlik
    dilimler. Küçük bölümler komşusuna katılır; en fazla STUDY_MAX_SECTIONS bölüm.
    Girdi satırları: {page_number, section_title, content}. Çıktı: [{title, page_start, page_end, text, chars}]."""
    rows = [c for c in chunks if (c.get("content") or "").strip()]
    if not rows:
        return []
    titled = [c for c in rows if (c.get("section_title") or "").strip()]
    secs: list[dict] = []
    if len({(c.get("section_title") or "").strip() for c in titled}) >= 2 and len(titled) >= len(rows) * 0.5:
        cur = None
        for c in rows:
            t = (c.get("section_title") or "").strip() or (cur["title"] if cur else "Giriş")
            if not cur or t != cur["title"]:
                cur = {"title": t, "page_start": c.get("page_number") or 1, "page_end": c.get("page_number") or 1, "parts": []}
                secs.append(cur)
            cur["parts"].append(c)
            cur["page_end"] = c.get("page_number") or cur["page_end"]
    else:
        # başlık yok: sayfa korumalı ~12K karakterlik dilimler
        cur, size = None, 0
        for c in rows:
            if not cur or size >= 12000:
                cur = {"title": "", "page_start": c.get("page_number") or 1, "page_end": c.get("page_number") or 1, "parts": []}
                secs.append(cur)
                size = 0
            cur["parts"].append(c)
            cur["page_end"] = c.get("page_number") or cur["page_end"]
            size += len(c.get("content") or "")
        for i, s in enumerate(secs, 1):
            s["title"] = f"Bölüm {i} (s. {s['page_start']}–{s['page_end']})" if s["page_end"] != s["page_start"] else f"Bölüm {i} (s. {s['page_start']})"

    def finish(s):
        lines = []
        for c in s["parts"]:
            pg = c.get("page_number")
            lines.append((f"[s.{pg}] " if pg else "") + (c.get("content") or "").strip())
        s["text"] = "\n".join(lines)
        s["chars"] = len(s["text"])
        s.pop("parts", None)
        return s

    secs = [finish(s) for s in secs]
    # küçük bölümleri komşusuna kat
    merged: list[dict] = []
    for s in secs:
        if merged and (s["chars"] < STUDY_MIN_SECTION_CHARS or merged[-1]["chars"] < STUDY_MIN_SECTION_CHARS):
            m = merged[-1]
            m["text"] += "\n" + s["text"]
            m["chars"] = len(m["text"])
            m["page_end"] = s["page_end"]
            if m["chars"] - s["chars"] < STUDY_MIN_SECTION_CHARS and s["title"] and s["title"] not in m["title"]:
                m["title"] = (m["title"] + " · " + s["title"])[:120]
        else:
            merged.append(dict(s))
    # çok fazla bölüm: ardışıkları birleştir
    while len(merged) > STUDY_MAX_SECTIONS:
        k = len(merged) / STUDY_MAX_SECTIONS
        out, i = [], 0
        while i < len(merged):
            group = merged[i:i + max(2, int(round(k)))]
            m = dict(group[0])
            for g in group[1:]:
                m["text"] += "\n" + g["text"]
                m["page_end"] = g["page_end"]
            m["chars"] = len(m["text"])
            out.append(m)
            i += len(group)
        merged = out
    return merged


def _sample_section(text: str, limit: int) -> str:
    """Bölüm metni bütçeye sığmıyorsa baş + son (yarı yarıya)."""
    if len(text) <= limit:
        return text
    h = int(limit * 0.6)
    t = limit - h
    return text[:h].rsplit(" ", 1)[0] + "\n[…]\n" + text[-t:].split(" ", 1)[-1]


_STUDY_SYSTEM = (
    "Sen bir öğrenme tasarımcısı ve deneyimli bir öğretmensin; lisans mezunu, meraklı bir yetişkin öğrenen için "
    "kaynağı BÖLÜM BÖLÜM ders notuna çeviriyorsun. Amaç: okuyan kişi belgeyi açmadan ne anlattığını bilsin, "
    "hangi bölümü derin okuması gerektiğini seçebilsin ve kavramların nasıl bağlandığını anlatabilsin.\n\n"
    "KURALLAR (kesin):\n"
    "1. Yalnızca Türkçe yaz; özgün terim gerekirse parantez içinde.\n"
    "2. Metadata değil içerik: yazar, üniversite, dergi, yayın yılı, sayfa sayısı yazma.\n"
    "3. HER paragrafın sonuna bilginin geçtiği sayfayı [s.N] olarak ekle (metin parçaları [s.N] etiketleriyle geliyor; "
    "   etiketi aynen kullan, uydurma). Birden fazla sayfa ise [s.3] [s.5] gibi ayrı yaz.\n"
    "4. Her bölüm için body_md: 1-3 paragraf Markdown; tanımlar, mekanizma/neden-sonuç, varsa şekil-tablo yorumu, "
    "   somut örnek. Başlık (#) KOYMA; **kalın** ile anahtar kavramı işaretle. Madde listesi yalnız gerçekten liste olan yerde.\n"
    "5. Kaynakta olmayan bilgi eklemek gerekirse paragrafı 'Genel bilgi:' ile başlat ve [s.N] koyma.\n"
    "6. Konuşma dili tekrarlarını (video dökümü) ayıkla; öz bilgiyi yaz.\n"
    "7. Sade, 'sen' diliyle; teknik jargon gereksiz yere yok."
)


def _wrap_rules() -> str:
    return (
        "- concept_relations_md: 5-10 cümlelik DÜZ YAZI (harita/tablo yok): ana kavramlar birbirine nasıl bağlanıyor, "
        "hangisi hangisinin ön koşulu, nerede neden-sonuç var. İlgili yerde [s.N].\n"
        "- misconceptions: 3-5 madde; 'Sık yanlış anlama → doğrusu' biçiminde tek cümle, kaynağa göre.\n"
        "- questions: TAM 5 sorgulayıcı soru ('Neden…', 'Nasıl…', '… olmasaydı…', '… ile … farkı…'); "
        "cevabı kaynakta olan; page: cevabın geçtiği sayfa (bilinmiyorsa 0)."
    )


def _validate_sections(secs_out: list[dict], secs_in: list[dict]) -> list[dict]:
    """Modelden gelen bölümleri temizler: boşları atar, [s.N] olmayan paragrafa bölümün başlangıç sayfasını ekler."""
    out = []
    for i, s in enumerate(secs_out or []):
        body = (s.get("body_md") or "").strip()
        if not body:
            continue
        ref = secs_in[i] if i < len(secs_in) else None
        ps = s.get("page_start") if isinstance(s.get("page_start"), int) and s.get("page_start") > 0 else (ref["page_start"] if ref else 0)
        paras = []
        for p in re.split(r"\n{2,}", body):
            p = p.strip()
            if not p:
                continue
            if not _PAGE_TAG_RE.search(p) and ps and not p.lower().startswith("genel bilgi"):
                p += f" [s.{ps}]"
            paras.append(p)
        title = (s.get("title") or (ref["title"] if ref else f"Bölüm {i + 1}")).strip()
        out.append({"title": title[:140], "page_start": ps or None, "body_md": "\n\n".join(paras)})
    return out


def _words(*texts: str) -> int:
    return sum(len(re.findall(r"\S+", t or "")) for t in texts)


def study_note_single(doc_title: str, sections: list[dict], total_chars: int) -> dict:
    """Kısa/orta belge: tek istekte bölüm notları + toparlama."""
    from app.ai.schemas import STUDY_NOTE_FULL_SCHEMA
    llm = get_llm()
    lo, hi = _target_words(total_chars)
    body = "\n\n".join(f"### BÖLÜM {i + 1}: {s['title']} (s. {s['page_start']}–{s['page_end']})\n{s['text']}"
                       for i, s in enumerate(sections))
    user = (
        f"KAYNAK: {doc_title}\n\nAşağıdaki {len(sections)} bölümün HER BİRİ için bir not yaz (sections dizisi aynı sırada, "
        f"title bölümün adı, page_start başlangıç sayfası). Toplam uzunluk {lo}-{hi} kelime; bölümlere içeriğine göre dağıt.\n"
        f"Ardından toparlama alanlarını doldur:\n{_wrap_rules()}\n\nMETİN:\n{body[:STUDY_SINGLE_CALL_CHARS + 4000]}"
    )
    raw = _structured(llm, [{"role": "system", "content": _STUDY_SYSTEM}, {"role": "user", "content": user}],
                      STUDY_NOTE_FULL_SCHEMA, temperature=0.4, max_output_tokens=8192)
    data = json.loads(raw)
    return _finish_note(data, sections, calls=1, mode="single")


def study_note_map(doc_title: str, sections: list[dict], total_chars: int) -> list[dict]:
    """Uzun belge, 1. istek: bölüm başına örneklenmiş metinden bölüm notları."""
    from app.ai.schemas import STUDY_NOTE_SECTIONS_SCHEMA
    llm = get_llm()
    lo, hi = _target_words(total_chars)
    tot = sum(s["chars"] for s in sections) or 1
    parts = []
    for i, s in enumerate(sections):
        share = max(2500, int(STUDY_MAP_BUDGET_CHARS * s["chars"] / tot))
        parts.append(f"### BÖLÜM {i + 1}: {s['title']} (s. {s['page_start']}–{s['page_end']})\n{_sample_section(s['text'], share)}")
    user = (
        f"KAYNAK: {doc_title}\n\nAşağıdaki {len(sections)} bölümün HER BİRİ için bir not yaz (sections dizisi aynı sırada). "
        f"Toplam {lo}-{hi} kelime; uzun bölümlere daha çok yer ver. Bölüm metinleri örneklenmiştir ([…] atlanan kısım).\n\n"
        + "\n\n".join(parts)
    )
    raw = _structured(llm, [{"role": "system", "content": _STUDY_SYSTEM}, {"role": "user", "content": user}],
                      STUDY_NOTE_SECTIONS_SCHEMA, temperature=0.4, max_output_tokens=8192)
    return _validate_sections(json.loads(raw).get("sections", []), sections)


def study_note_reduce(doc_title: str, section_notes: list[dict]) -> dict:
    """Uzun belge, 2. istek: bölüm notlarından kavram ilişkileri, yanlış anlamalar, sorular."""
    from app.ai.schemas import STUDY_NOTE_WRAP_SCHEMA
    llm = get_llm()
    notes = "\n\n".join(f"## {s['title']}\n{s['body_md']}" for s in section_notes)
    user = (f"KAYNAK: {doc_title}\n\nAşağıda bu kaynağın bölüm bölüm ders notu var. Notlardaki [s.N] etiketlerini kullanarak "
            f"toparlama alanlarını doldur:\n{_wrap_rules()}\n\nNOTLAR:\n{notes[:60000]}")
    raw = _structured(llm, [{"role": "system", "content": _STUDY_SYSTEM}, {"role": "user", "content": user}],
                      STUDY_NOTE_WRAP_SCHEMA, temperature=0.4, max_output_tokens=4096)
    return json.loads(raw)


def _finish_note(data: dict, sections_in: list[dict], calls: int, mode: str, sections_done: list[dict] | None = None) -> dict:
    secs = sections_done if sections_done is not None else _validate_sections(data.get("sections", []), sections_in)
    qs = []
    for q in (data.get("questions") or [])[:5]:
        if isinstance(q, dict) and (q.get("q") or "").strip():
            pg = q.get("page")
            qs.append({"q": q["q"].strip(), "page": pg if isinstance(pg, int) and pg > 0 else None})
        elif isinstance(q, str) and q.strip():
            qs.append({"q": q.strip(), "page": None})
    rel = (data.get("concept_relations_md") or "").strip()
    mis = [str(m).strip() for m in (data.get("misconceptions") or []) if str(m).strip()][:6]
    from datetime import datetime, timezone
    return {
        "version": STUDY_NOTE_VERSION,
        "mode": mode,
        "calls": calls,
        "sections": secs,
        "concept_relations_md": rel,
        "misconceptions": mis,
        "questions": qs,
        "words": _words(*(s["body_md"] for s in secs), rel, *mis, *(q["q"] for q in qs)),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def generate_study_note(doc_title: str, chunks: list[dict]) -> dict:
    """Belge L2 ders notu. Kısa belgede 1 istek; uzun belgede map (1) + reduce (1) = 2 istek."""
    sections = build_sections(chunks)
    if not sections:
        raise ValueError("no text")
    total = sum(s["chars"] for s in sections)
    plan = study_note_plan(total)
    if plan["mode"] == "single":
        return study_note_single(doc_title, sections, total)
    notes = study_note_map(doc_title, sections, total)
    wrap = study_note_reduce(doc_title, notes)
    return _finish_note(wrap, sections, calls=2, mode="map_reduce", sections_done=notes)


def note_to_markdown(note: dict, title: str = "") -> str:
    """L2 notunu düz Markdown'a çevirir (geri bildirim bağlamı, dışa aktarma)."""
    out = [f"# {title}"] if title else []
    for s in note.get("sections") or []:
        out.append(f"## {s.get('title') or ''}")
        out.append(s.get("body_md") or "")
    if note.get("concept_relations_md"):
        out += ["## Kavramlar nasıl bağlanıyor", note["concept_relations_md"]]
    if note.get("misconceptions"):
        out += ["## Sık yanlış anlamalar"] + [f"- {m}" for m in note["misconceptions"]]
    if note.get("questions"):
        out += ["## Kendini sına"] + [f"{i + 1}. {q.get('q')}" for i, q in enumerate(note["questions"])]
    return "\n\n".join(x for x in out if x)


def synthesis_note(notebook_title: str, sources: list[dict]) -> dict:
    """Defter sentez notu (1 istek). sources: [{k, title, l0, l1, goals, concepts, note_md}] — k = [K#] numarası.
    Çıktı Markdown alanlarında atıf biçimi [K2 s.4] (kaynak numarası + sayfa)."""
    from app.ai.schemas import SYNTHESIS_NOTE_SCHEMA
    llm = get_llm()
    per = max(1500, 60000 // max(1, len(sources)))
    blocks = []
    for s in sources:
        b = [f"[K{s['k']}] {s['title']}"]
        if s.get("l0"):
            b.append(f"Tek cümle: {s['l0']}")
        if s.get("l1"):
            b.append(f"Özet: {s['l1']}")
        if s.get("goals"):
            b.append("Öğrenme hedefleri: " + " | ".join(s["goals"][:5]))
        if s.get("concepts"):
            b.append("Kavramlar: " + ", ".join(s["concepts"][:10]))
        if s.get("note_md"):
            b.append("Ders notu:\n" + s["note_md"])
        blocks.append("\n".join(b)[:per])
    system = (
        "Sen deneyimli bir öğretmensin; lisans mezunu bir öğrenen için bir defterdeki kaynakları BİRLEŞTİREN sentez notu yazıyorsun. "
        "Yalnızca Türkçe, 'sen' diliyle, Markdown. Metadata (yazar, dergi, yıl) yok; içerik var. "
        "Her iddianın sonuna kaynak atıfı: [K2] ya da sayfa biliniyorsa [K2 s.4] (kaynak numaraları aşağıda). Uydurma yok; "
        "kaynaklar bir konuda sessizse 'kaynaklar bunu ele almıyor' de.\n"
        "ALANLAR:\n"
        "- overview_md: 1 paragraf (80-140 kelime): defterin büyük resmi, kaynaklar birlikte hangi soruya cevap veriyor.\n"
        "- common_md: ORTAK KAVRAMLAR ve uzlaşılar — 5-10 cümle ya da kısa maddeler, her biri atıflı.\n"
        "- conflicts_md: ÇELİŞKİLER / ayrışmalar — hangi kaynak ne diyor, fark neden olabilir (yöntem, örneklem, bağlam). Yoksa açıkça 'Belirgin çelişki yok' + neden.\n"
        "- complementary_md: TAMAMLAYICI noktalar — bir kaynağın bıraktığı boşluğu hangisi dolduruyor.\n"
        "- reading_order: önerilen okuma sırası, 'K3 — neden önce' biçiminde kısa maddeler.\n"
        "- questions: 5 sorgulayıcı soru (kaynaklar arası).\n"
        "Toplam 700-1400 kelime."
    )
    user = f"DEFTER: {notebook_title}\n\nKAYNAKLAR:\n\n" + "\n\n---\n\n".join(blocks)
    raw = _structured(llm, [{"role": "system", "content": system}, {"role": "user", "content": user}],
                      SYNTHESIS_NOTE_SCHEMA, temperature=0.4, max_output_tokens=8192)
    data = json.loads(raw)
    from datetime import datetime, timezone
    out = {
        "version": STUDY_NOTE_VERSION,
        "overview_md": (data.get("overview_md") or "").strip(),
        "common_md": (data.get("common_md") or "").strip(),
        "conflicts_md": (data.get("conflicts_md") or "").strip(),
        "complementary_md": (data.get("complementary_md") or "").strip(),
        "reading_order": [str(x).strip() for x in (data.get("reading_order") or []) if str(x).strip()][:12],
        "questions": [str(x).strip() for x in (data.get("questions") or []) if str(x).strip()][:6],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    out["words"] = _words(out["overview_md"], out["common_md"], out["conflicts_md"], out["complementary_md"],
                          *out["reading_order"], *out["questions"])
    return out


def study_feedback(user_text: str, note_md: str, title: str) -> str:
    """'Kendi sözlerinle anlat' (Feynman): kullanıcının anlatımı ders notuyla karşılaştırılır. 200-400 kelime Markdown."""
    llm = get_llm()
    system = (
        "Sen sabırlı, dürüst bir öğretmensin. Öğrenen bir kaynağı KENDİ SÖZLERİYLE anlattı; sen bu anlatımı aşağıdaki ders notuna "
        "(ve yalnızca ona) göre değerlendiriyorsun. Türkçe, 'sen' diliyle, sıcak ama net; 200-400 kelime Markdown.\n"
        "YAPI (başlıklar aynen):\n"
        "### İyi yakaladıkların\n- 2-4 madde: doğru kavradığı noktalar; hangi kavramı doğru bağladığını söyle.\n"
        "### Eksik kalanlar\n- 2-4 madde: nottaki önemli ama anlatımda olmayan noktalar; her birinde ilgili sayfa [s.N] (notta varsa).\n"
        "### Yanlış ya da karışık\n- 0-3 madde: hatalı nedensellik, karıştırılan kavram, belirsiz ifade → doğrusu kısa. Hata yoksa tek satır 'Belirgin bir yanlış görmedim.'\n"
        "### Bir adım ileri\nTek bir soru: anlatımını bir seviye derinleştirecek 'neden/nasıl' sorusu.\n"
        "Kaynakta olmayan bilgi uydurma; küçük düşürme; puan/not verme."
    )
    user = f"KAYNAK: {title}\n\nÖĞRENENİN ANLATIMI:\n{user_text[:6000]}\n\nDERS NOTU:\n{note_md[:40000]}"
    return _complete(llm, [{"role": "system", "content": system}, {"role": "user", "content": user}],
                     temperature=0.5, max_output_tokens=4096).strip()
