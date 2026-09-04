import json
from app.ai.factory import get_llm
from app.ai.schemas import DOCUMENT_ANALYSIS_SCHEMA, STUDY_ITEMS_SCHEMA
from app.config import settings


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


def generate_study_items(context: str, kind: str, count: int = 8) -> list[dict]:
    llm = get_llm()
    instr = {
        "flashcard": "kısa soru-cevap flashcard'ları",
        "quiz": "çoktan seçmeli quiz soruları (options doldur, answer doğru şıkkı yaz)",
        "open_question": "açık uçlu düşündürücü sorular",
    }.get(kind, "flashcard'lar")
    messages = [
        {"role": "system", "content": "Sen bir öğrenme materyali üreticisisin. Türkçe üret, kaynağa sadık kal."},
        {"role": "user", "content": f"Aşağıdaki içerikten {count} adet {instr} üret. "
                                     f"Flashcard/açık uçlu için options boş dizi olsun.\n\n{context[:16000]}"},
    ]
    raw = llm.structured(messages, STUDY_ITEMS_SCHEMA, model=settings.active_llm_model)
    return json.loads(raw).get("items", [])
