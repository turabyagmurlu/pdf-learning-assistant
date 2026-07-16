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
