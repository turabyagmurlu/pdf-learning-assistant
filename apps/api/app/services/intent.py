"""Sor — niyet anlama on adimi ve cevap sonrasi ayristirma yardimcilari.

Akis (collections._ask_core ve chat.send ortak):
  1. understand(): soru + son 6 mesaj -> {intent, rewritten_question, scope_hint, wants_length}
     Hafif model, ~200 cikti token'i, kullanim turu "hafif" (kisinin ⚡ sayacina eklenmez).
     Model yoksa / JSON bozuksa / zaman asimi: soru oldugu gibi kullanilir (hic bir sey kirilmaz).
  2. Arama rewritten_question ile yapilir ("devam et", "peki ya X" gibi takipler onceki soruya baglanir).
  3. Cevabin sonunda model FOLLOWUP_HEADING ("## Devam soruları") basligi altina 3 devam sorusu yazar;
     split_followups() bunlari govdeden ayirir (eski <<<DEVAM>>> ve bozuk bicimler de yakalanir),
     TailGuard akista isaretin ekrana sizmasini engeller, clean_answer_payload() kayitli cevabi temizler.

Bu dosya saf fonksiyonlardan olusur; `understand` disinda ag/DB yoktur (testlenebilir).
"""
from __future__ import annotations

import json
import re

INTENTS = ("acikla", "karsilastir", "ozetle", "ornekle", "sorgula", "devam", "tanimla", "liste")
DEPTHS = ("kisa", "ayrintili", "derin")
DEFAULT_DEPTH = "ayrintili"
HISTORY_TURNS = 3          # 3 tur = 6 mesaj (soru + cevap)
HISTORY_ANSWER_CHARS = 1500

# Devam sorulari cevabin icine gomulmez: model govdenin sonunda sabit bir baslik yazar, sorular onun altinda.
# Istemde FOLLOWUP_HEADING istenir; ayristirma toleranslidir (bkz. FOLLOWUP_LINE_RE): "<<<DEVAM>>>", "<<<DEVAM",
# "<<< devam >>>", "DEVAM:", "## Devam soruları", "**Devam Soruları:**", "### DEVAM SORULARI" ... hepsi yakalanir.
FOLLOWUP_HEADING = "## Devam soruları"
FOLLOWUP_MARKER = "<<<DEVAM>>>"          # eski isaret (eski kayitlar ve modelin alistigi bicim icin kabul edilir)

# Kullanici "takip" yaziyorsa (onceki soruya bagli kisa mesaj) niyet adimi SART.
_FOLLOW_CUES = re.compile(
    r"^(evet|hayır|hayir|peki|tamam|devam|daha|biraz|örnek|ornek|neden|nasıl|nasil|yani|ya |o |bu |şu |su |onu |bunu |"
    r"açıkla|acikla|anlat|genişlet|genislet|özetle|ozetle|kısalt|kisalt|tekrar)\b", re.I)
_FOLLOW_WORDS = re.compile(r"\b(devam|daha ayrıntılı|daha detaylı|daha fazla|örnek ver|peki ya|ya o|bunu|onu|şunu|"
                           r"açar mısın|anlatır mısın|genişlet|yukarıdaki|önceki|az önce|demin)\b", re.I)


def normalize_depth(value: str | None) -> str:
    v = (value or "").strip().lower()
    v = v.replace("ı", "i").replace("ş", "s").replace("ğ", "g")
    for d in DEPTHS:
        if v == d:
            return d
    return DEFAULT_DEPTH


def is_followup(question: str, has_history: bool) -> bool:
    """Onceki tura bagli gorunen kisa/takip sorusu mu?"""
    if not has_history:
        return False
    q = (question or "").strip()
    words = q.split()
    if len(words) <= 3 and not re.search(r"\bnedir\b|ne demek", q, re.I):
        return True
    return bool(_FOLLOW_CUES.match(q) or _FOLLOW_WORDS.search(q))


def rule_intent(question: str) -> str:
    """Model olmadan kaba niyet (yedek ve kisa yol)."""
    q = (question or "").lower()
    if re.search(r"karşılaştır|karsilastir|fark(ı|i|lar)|ayrış|ayris|benzerlik|hangisi", q):
        return "karsilastir"
    if re.search(r"\bneden\b|\bniçin\b|\bnicin\b|nasıl|nasil|açıkla|acikla|anlat", q):
        return "acikla"
    if re.search(r"özet|ozet|ana fikir|kısaca|kisaca|genel hat", q):
        return "ozetle"
    if re.search(r"örnek|ornek|somutla|uygula", q):
        return "ornekle"
    if re.search(r"listele|sırala|sirala|maddele|hangileri|neler(dir)?\b", q):
        return "liste"
    if re.search(r"\bnedir\b|ne demek|tanım|tanim|kavram", q):
        return "tanimla"
    if re.search(r"eleştir|elestir|zayıf|zayif|tartış|tartis|doğru mu|dogru mu|kanıt|kanit|sorgula|güvenilir", q):
        return "sorgula"
    if re.search(r"^devam|daha ayrıntılı|daha detaylı|genişlet|genislet", q):
        return "devam"
    return "acikla"


def fallback(question: str, has_history: bool = False) -> dict:
    """Niyet adimi basarisizsa: soru oldugu gibi, kaba niyet, 'uzun' istek."""
    q = (question or "").strip()
    return {"intent": rule_intent(q) if not (has_history and is_followup(q, True)) else "devam",
            "rewritten_question": q, "scope_hint": "", "wants_length": "uzun", "ok": False}


def _extract_json(raw: str) -> dict | None:
    """Kod citi, on/arka metin, tek tirnak gibi kucuk bozukluklara tolerans."""
    if not raw or not isinstance(raw, str):
        return None
    s = raw.strip()
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s, flags=re.I | re.M).strip()
    for cand in (s,):
        try:
            v = json.loads(cand)
            if isinstance(v, dict):
                return v
        except Exception:  # noqa
            pass
    # ilk { ... son }
    a, b = s.find("{"), s.rfind("}")
    if a != -1 and b > a:
        frag = s[a:b + 1]
        for fix in (frag, re.sub(r",\s*([}\]])", r"\1", frag)):     # sondaki virgul
            try:
                v = json.loads(fix)
                if isinstance(v, dict):
                    return v
            except Exception:  # noqa
                continue
    return None


def parse_intent_json(raw: str, question: str, has_history: bool = False) -> dict:
    """Modelin dondurdugu metni dogrulanmis niyet nesnesine cevirir; her bozuklukta fallback()."""
    q = (question or "").strip()
    v = _extract_json(raw)
    if not v:
        return fallback(q, has_history)
    intent = str(v.get("intent") or "").strip().lower()
    intent = intent.replace("ı", "i").replace("ş", "s").replace("ç", "c").replace("ğ", "g").replace("ö", "o").replace("ü", "u")
    if intent not in INTENTS:
        intent = rule_intent(q)
    rq = v.get("rewritten_question")
    rq = re.sub(r"\s+", " ", str(rq)).strip() if isinstance(rq, str) else ""
    # Cok kisa / cok uzun / soruyla alakasiz uzunlukta yeniden yazim guvenilmez -> orijinal
    if len(rq) < 3 or len(rq) > 600:
        rq = q
    scope = v.get("scope_hint")
    scope = re.sub(r"\s+", " ", str(scope)).strip()[:200] if isinstance(scope, str) else ""
    wl = str(v.get("wants_length") or "").strip().lower().replace("ı", "i")
    if wl not in ("kisa", "uzun"):
        wl = "uzun"
    return {"intent": intent, "rewritten_question": rq, "scope_hint": scope, "wants_length": wl, "ok": True}


INTENT_PROMPT = """Sen bir öğrenme uygulamasında soruyu anlayan yardımcısın. Görevin cevap vermek DEĞİL; \
kullanıcının ne istediğini anlamak ve soruyu, sohbet geçmişi olmadan da anlaşılacak TAM bir soruya çevirmek.

Kurallar:
- "devam et", "daha ayrıntılı", "evet", "peki ya X", "bunu örnekle" gibi takipler ÖNCEKİ soruya bağlıdır; \
rewritten_question önceki konuyu açıkça içersin (örn. "Uşi Antlaşması'nın ekonomik sonuçlarını ayrıntılı anlat").
- Soru zaten bağımsız ve açıksa rewritten_question onu neredeyse aynen korur (anlamı değiştirme, eklemelerle şişirme).
- intent: acikla | karsilastir | ozetle | ornekle | sorgula | devam | tanimla | liste
- wants_length: kullanıcı "kısaca/tek cümleyle" gibi bir şey dediyse "kisa", yoksa "uzun".
- scope_hint: hangi belge/bölüm/sayfa ya da kavrama odaklanılacağına dair kısa ipucu (yoksa boş).
SADECE şu JSON'u döndür: {"intent": "...", "rewritten_question": "...", "scope_hint": "...", "wants_length": "kisa|uzun"}"""


def history_messages(turns: list[tuple[str, str]], max_turns: int = HISTORY_TURNS,
                     answer_chars: int = HISTORY_ANSWER_CHARS) -> list[dict]:
    """(soru, cevap) ciftlerini modele giden user/assistant mesajlarina cevirir; uzun cevaplar kirpilir."""
    out: list[dict] = []
    for q, a in list(turns)[-max_turns:]:
        q = (q or "").strip()
        a = (a or "").strip()
        if not q:
            continue
        out.append({"role": "user", "content": q[:1000]})
        if a:
            if len(a) > answer_chars:
                a = a[:answer_chars].rsplit(" ", 1)[0] + " …"
            out.append({"role": "assistant", "content": a})
    return out


def history_digest(turns: list[tuple[str, str]], max_turns: int = HISTORY_TURNS) -> str:
    lines = []
    for q, a in list(turns)[-max_turns:]:
        lines.append(f"Kullanıcı: {(q or '').strip()[:300]}")
        if a:
            lines.append(f"Yardımcı: {(a or '').strip()[:400]}")
    return "\n".join(lines) if lines else "(geçmiş yok)"


def needs_model(question: str, turns: list[tuple[str, str]]) -> bool:
    """Niyet adimi icin model gerekir mi? Gecmis yoksa ve soru kendi basina anlasilir uzunluktaysa
    kural tabanli niyet yeter (istek ve sure tasarrufu)."""
    if turns:
        return True
    return len((question or "").split()) < 6


def understand(llm, question: str, turns: list[tuple[str, str]], model: str | None = None) -> dict:
    """Niyet anlama (senkron; cagiran to_thread ile sarar). Hata = fallback, istisna firlatmaz."""
    q = (question or "").strip()
    if not needs_model(q, turns):
        d = fallback(q)
        d["ok"] = True
        return d
    try:
        from app.config import settings
        from app.ai.usage import LIGHT_KIND
        messages = [{"role": "system", "content": INTENT_PROMPT},
                    {"role": "user", "content": f"Sohbet geçmişi (eskiden yeniye):\n{history_digest(turns)}\n\n"
                                                f"Yeni mesaj: {q}"}]
        raw = llm.complete(messages, model=model or settings.active_llm_model_light,
                           temperature=0.1, max_output_tokens=300, kind=LIGHT_KIND)
        return parse_intent_json(raw, q, has_history=bool(turns))
    except Exception:  # noqa - niyet adimi hic bir zaman cevabi engellemez
        return fallback(q, has_history=bool(turns))


# ------------------------------------------------------------------ cevap sonrasi ayristirma

_CITE_IN_Q = re.compile(r"\s*\[K\s*\d+(?:\s*s\.\s*\d+)?(?:\s*[,;]\s*K?\s*\d+(?:\s*s\.\s*\d+)?)*\]")

# "Devam soruları" basliginin satir ici bicimleri (buyuk/kucuk harf, Turkce I/İ/ı, eksik '>>>', iki nokta, Markdown).
_SORULARI = r"sorular[ıiIİ]?"
_DEVAM_WORD = r"[Dd][Ee][Vv][Aa][Mm]"
_MARK_CORE = (
    r"(?:"
    r"<{2,}\s*" + _DEVAM_WORD + r"(?:\s+" + _SORULARI + r")?\s*:?\s*>{0,3}"          # <<<DEVAM>>>, <<<DEVAM, <<< devam >>>
    r"|#{1,6}\s*" + _DEVAM_WORD + r"\s+" + _SORULARI + r"\s*:?\s*>{0,3}"             # ## Devam soruları
    r"|\*{1,2}\s*" + _DEVAM_WORD + r"\s+" + _SORULARI + r"\s*:?\s*\*{0,2}"            # **Devam soruları:**
    r"|" + _DEVAM_WORD + r"\s+" + _SORULARI + r"\s*:"                                 # Devam soruları:
    r"|" + _DEVAM_WORD + r"\s*:"                                                       # DEVAM:
    r")"
)
_LINE_PREFIX = r"^[ \t]*[*_>]*[ \t]*"
_LINE_SUFFIX = r"[ \t*_:>]*"
# Tam satir: yalniz isaret (tek basina "Devam soruları" da sayilir). Akista (TailGuard) ve temizlikte kullanilir.
FOLLOWUP_LINE_RE = re.compile(_LINE_PREFIX + r"(?:" + _MARK_CORE + r"|" + _DEVAM_WORD + r"\s+" + _SORULARI + r")"
                              + _LINE_SUFFIX + r"\r?\n?$", re.I)
# Govdeyi bolme: satir basinda isaret (ayni satirda soru da yazilmis olabilir, o yuzden '$' yok).
FOLLOWUP_SPLIT_RE = re.compile(_LINE_PREFIX + _MARK_CORE + _LINE_SUFFIX, re.M | re.I)
# Yedek: isaret bozuksa bile sondaki "devam" gecen kisa satir (ve altindaki birkac madde) kirpilir.
_LOOSE_DEVAM_LINE = re.compile(r"^[^\n]{0,8}" + _DEVAM_WORD + r"[^\n]{0,40}$", re.M)
_TRAILING_RULE = re.compile(r"(?:\n[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*)+\s*$")


def _clean_question(line: str) -> str:
    s = re.sub(r"^\s*(?:[-*•–]|\d+[.)])\s*", "", line).strip().strip("*_").strip()
    s = _CITE_IN_Q.sub("", s).strip()
    s = s.strip("\"'«»“”").strip()
    return s


def _parse_questions(tail: str, limit: int) -> list[str]:
    qs: list[str] = []
    for line in tail.splitlines():
        if FOLLOWUP_LINE_RE.match(line + "\n"):
            continue
        s = _clean_question(line)
        if not s or re.match(_MARK_CORE, s, re.I) or s.startswith(("#", "<")):
            continue
        if len(s) >= 8 and s not in qs:
            qs.append(s)
        if len(qs) >= limit:
            break
    return qs


def _trim_body(body: str) -> str:
    b = body.rstrip()
    # Sondaki yatay cizgi / artik isaret satirlari
    for _ in range(3):
        b2 = _TRAILING_RULE.sub("", b).rstrip()
        b2 = re.sub(r"\n" + _LINE_PREFIX.lstrip("^") + _MARK_CORE + _LINE_SUFFIX + r"\s*$", "", b2, flags=re.I).rstrip()
        if b2 == b:
            break
        b = b2
    return b


def split_followups(text: str, limit: int = 3) -> tuple[str, list[str]]:
    """Govde + devam sorulari. Isaret satiri toleransli aranir (<<<DEVAM>>>, <<<DEVAM, DEVAM:, ## Devam soruları...).
    Hic eslesme yoksa yedek: metnin SONUNDAKI 'devam' gecen kisa satir ve altindaki birkac satir kirpilir.
    Govdede isaretten iz kalmaz."""
    t = (text or "").replace("\r\n", "\n")
    if not t.strip():
        return "", []
    matches = list(FOLLOWUP_SPLIT_RE.finditer(t))
    m = None
    if matches:
        # Isaret cevabin sonlarinda beklenir: metnin ilk %30'undaki (yanlis pozitif olabilecek) eslesmeyi atla
        late = [x for x in matches if x.start() >= len(t) * 0.3]
        m = (late or matches)[0]
    if m is not None:
        body, tail = t[:m.start()], t[m.end():]
        return _trim_body(body), _parse_questions(tail, limit)
    # Yedek: sondaki "devam" satiri (son 1200 karakter icinde, altinda en fazla 6 dolu satir)
    window_start = max(0, len(t) - 1200)
    loose = [x for x in _LOOSE_DEVAM_LINE.finditer(t) if x.start() >= window_start]
    if loose:
        x = loose[-1]
        tail = t[x.end():]
        after = [ln for ln in tail.splitlines() if ln.strip()]
        head = x.group(0).strip()
        looks_label = len(head) <= 40 and (head.lower().endswith((":", "soruları", "sorulari", ">")) or head.startswith("<"))
        if looks_label and len(after) <= 6 and all(len(ln) <= 220 for ln in after):
            return _trim_body(t[:x.start()]), _parse_questions(tail, limit)
    return _trim_body(t), []


def clean_answer_payload(payload: dict) -> dict:
    """Kayitli/kaydedilecek cevaptan isareti ve devam blogunu ayirir; followups bos ise ayrilanlari koyar.
    Eski kayitlar (govdeye gomulu <<<DEVAM) okunurken de kullanilir; dict degilse oldugu gibi doner."""
    if not isinstance(payload, dict):
        return payload
    ans = payload.get("answer")
    if not isinstance(ans, str) or not ans:
        return payload
    body, qs = split_followups(ans)
    if body == ans:
        return payload
    out = dict(payload)
    out["answer"] = body
    if qs and not out.get("followups"):
        out["followups"] = qs
    return out


def strip_followups(text: str) -> str:
    """Yalniz govde (okuyucu sohbeti mesajlari icin)."""
    return split_followups(text)[0]


# Akista geride tutulan satir basi: bu kadar karakterden sonra isaret olamaz, satir serbest birakilir
_HOLD_MAX = 40


class TailGuard:
    """Akista devam-sorulari isareti ekrana sizmasin.
    Satir satir calisir: tamamlanan satir isaretse (FOLLOWUP_LINE_RE) akis durur, sonrasi yutulur (tam metin
    cagiranin elinde). Henuz bitmemis satir, isaretin baslangici olabilecek bir on ekle ("<", "#", "*", "devam"...)
    basliyorsa en fazla _HOLD_MAX karaktere kadar geride tutulur; sonra serbest kalir.
    feed(tok) -> ekrana gidebilecek metin; flush() -> kalan (isaret degilse)."""

    def __init__(self, marker: str | None = None):
        self.buf = ""
        self.stopped = False

    @staticmethod
    def _suspicious(partial: str) -> bool:
        s = partial.lstrip(" \t*_>#")
        if len(partial) > _HOLD_MAX:
            return False
        if not s:
            return True                        # yalniz bosluk/isaret karakterleri: bekle
        if s[0] == "<":
            return True
        low = s.lower().replace("ı", "i")
        return low.startswith("devam") or "devam".startswith(low)

    def feed(self, tok: str) -> str:
        if self.stopped:
            return ""
        self.buf += tok
        out = ""
        while True:
            nl = self.buf.find("\n")
            if nl == -1:
                break
            line, self.buf = self.buf[:nl + 1], self.buf[nl + 1:]
            if FOLLOWUP_LINE_RE.match(line) or FOLLOWUP_SPLIT_RE.match(line):
                self.stopped, self.buf = True, ""
                return out
            out += line
        if self.buf and not self._suspicious(self.buf):
            out, self.buf = out + self.buf, ""
        return out

    def flush(self) -> str:
        if self.stopped:
            self.buf = ""
            return ""
        out, self.buf = self.buf, ""
        if FOLLOWUP_LINE_RE.match(out) or FOLLOWUP_SPLIT_RE.match(out):
            return ""
        return out
