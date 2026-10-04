"""tts_prepare / split_for_tts / sessizlik birim testleri (T5-ses §2.1, §2.5, §3).

Gemini'ye gitmez; kota 0. `httpx`/ayarlar ortamda yoksa hafif taklitler takilir
(yalniz saf metin fonksiyonlari test edilir).
"""
import sys
import types

try:  # pragma: no cover - ortama bagli
    import httpx  # noqa: F401
except ModuleNotFoundError:
    sys.modules["httpx"] = types.SimpleNamespace(Response=object, post=None, Timeout=None, TimeoutException=Exception)
try:  # pragma: no cover
    from app.config import settings  # noqa: F401
except Exception:
    cfg = types.ModuleType("app.config")
    cfg.settings = types.SimpleNamespace(gemini_api_key="", gemini_tts_model="")
    sys.modules["app.config"] = cfg
    err = types.ModuleType("app.core.errors")

    class AiUnavailable(Exception):
        def __init__(self, user_message=None, detail=None):
            super().__init__(user_message); self.user_message = user_message; self.detail = detail
    err.AiUnavailable = AiUnavailable
    sys.modules["app.core.errors"] = err
    us = types.ModuleType("app.ai.usage")
    sys.modules["app.ai.usage"] = us
    ai = types.ModuleType("app.ai"); ai.usage = us
    sys.modules.setdefault("app.ai", ai)

from app.services.tts_service import (tts_prepare, split_for_tts, split_sentences, num_to_words, ordinal_words,
                                      with_tail_silence, SILENCE_PCM, SAMPLE_TEXT, build_prompt, part_context,
                                      FEMALE_VOICES, MALE_VOICES, normalize_voice)


# ---- T5 §3 deneme metni ------------------------------------------------------------------
RAW = """OSMANLI EKONOMİSİ 1 2 3
Osmanlı Devleti'nde 16. yy.'ın ikinci yarısında yaşanan fiyat artışları (Pamuk, 2000: 112-118) uzun süre "fiyat devrimi" olarak ad-
landırılmıştır.¹ Bu dönemde gümüş akçenin değeri %44 düşmüş, buğday fiyatları ise 1550-1600 arasında yak. 2,5 kat artmıştır (bkz. Tablo 3).² Braudel vd. (1972) bu süreci Akdeniz ekonomisinin bütünü içinde değerlendirir. Tımar sistemi, M.Ö. dönemlerden gelen toprak düzenlerinden farklı olarak, 15. yy.'da kurumsallaşmıştır. Şekil 2'de görüldüğü gibi tımarlı sipahi sayısı 1527'de 37.521 iken 1609'da 44.404'e çıkmıştır. Celali isyanları (1596-1610), vergi yükü ve nüfus baskısıyla ilişkilendirilmektedir.³ İnalcık'a göre (1994: 55) "klasik dönem" 1300-1600 yılları arasını kapsar. Sonuç olarak 17. yy. Osmanlı ekonomisi, Avrupa'daki gelişmelerden bağımsız düşünülemez.
¹ Bkz. Barkan, 1975. ² TÜİK, 2010. ³ Akdağ, 1963, s. 45-47.
112
"""


def test_sample_text_t5():
    out = tts_prepare(RAW)
    # baslik / sayfa no / dipnot satirlari gitti
    assert "OSMANLI EKONOMİSİ" not in out and "112" not in out and "Barkan" not in out and "TÜİK" not in out
    # tire birlesti, kisaltmalar acildi
    assert "adlandırılmıştır" in out
    assert "on altıncı yüzyılın" in out and "on beşinci yüzyılda" in out and "on yedinci yüzyıl" in out
    assert "milattan önce" in out and "yaklaşık iki virgül beş kat" in out and "ve diğerleri" in out
    # atif / gorsel ref / dipnot numarasi yok
    assert "Pamuk" not in out and "1972" not in out and "1994" not in out
    assert "Tablo" not in out and "bkz" not in out.lower() and "Şekil" not in out and "görüldüğü gibi" not in out
    assert "¹" not in out and "²" not in out
    # sayilar yaziyla
    assert "yüzde kırk dört" in out
    assert "bin beş yüz elli ile bin altı yüz arasında" in out
    assert "bin beş yüz yirmi yedide otuz yedi bin beş yüz yirmi bir iken" in out
    assert "kırk dört bin dört yüz dörde" in out
    assert "bin üç yüz ile bin altı yüz yılları arasını" in out
    assert not any(ch.isdigit() for ch in out), out
    # tirnak ve parantez kalmadi
    assert '"' not in out and "(" not in out and ")" not in out


def test_decimal_dot():
    assert "on altı nokta beş" in tts_prepare("Değer 16.5 oldu.")


def test_bkz_table_removed():
    out = tts_prepare("Veriler artmıştır (BKZ. Tablo 3). Devam.")
    assert "Tablo" not in out and "BKZ" not in out.upper().replace("BKZ", "BKZ") or "BKZ" not in out
    assert out.startswith("Veriler artmıştır")


def test_hyphen_space_join():
    assert "protein" in tts_prepare("Hücrede pro- tein sentezi olur.")


def test_citation_number_dropped():
    out = tts_prepare("Bu sonuç önemlidir (10). Diğeri de [3] öyle.")
    assert "(10)" not in out and "[3]" not in out and "on" not in out.split("önemlidir")[1][:3]
    assert out == "Bu sonuç önemlidir. Diğeri de öyle."


def test_vb_expanded():
    assert tts_prepare("Elma, armut vb. meyveler.") == "Elma, armut ve benzeri meyveler."


def test_abbrev_titles():
    out = tts_prepare("Prof. Dr. Ahmet ve Doç. Dr. Ayşe, Dr. Can ile çalıştı.")
    assert out == "Profesör Doktor Ahmet ve Doçent Doktor Ayşe, Doktor Can ile çalıştı."


def test_percent_and_decimal_comma():
    assert tts_prepare("Oran %12,5 oldu.") == "Oran yüzde on iki virgül beş oldu."


def test_ordinal_first_world_war():
    out = tts_prepare("1. Dünya Savaşı 1914-1918 yılları arasında sürdü.")
    assert out.startswith("Birinci Dünya Savaşı") or out.startswith("birinci Dünya Savaşı")
    assert "bin dokuz yüz on dört ile bin dokuz yüz on sekiz yılları arasında" in out


def test_ordinal_suffix_apostrophe():
    assert tts_prepare("3'üncü sırada ve 1'inci sırada.") == "Üçüncü sırada ve birinci sırada."


def test_sentence_glue_and_dash():
    out = tts_prepare("Sonuç çıktı.Bu önemli — hem de çok.")
    assert out == "Sonuç çıktı. Bu önemli, hem de çok."


def test_colon_and_quotes():
    out = tts_prepare('Kural şu: "kısa cümle" yaz. Başlık: Ana fikir.')
    assert out == "Kural şu, kısa cümle yaz. Başlık. Ana fikir."


def test_paragraphs_kept_and_dialog_labels():
    out = tts_prepare("Birinci paragraf 2 cümle\n\nİkinci paragraf")
    assert out == "Birinci paragraf iki cümle.\n\nİkinci paragraf."
    d = tts_prepare("Ayşe: Bugün 3 konu var.\nKerem: Hangileri vb.?", dialog=True)
    assert d == "Ayşe: Bugün üç konu var.\nKerem: Hangileri ve benzeri?"


def test_sample_text_unchanged():
    assert tts_prepare(SAMPLE_TEXT) == SAMPLE_TEXT


def test_idempotent():
    once = tts_prepare(RAW)
    assert tts_prepare(once) == once


def test_num_to_words():
    assert num_to_words(0) == "sıfır"
    assert num_to_words(100) == "yüz"
    assert num_to_words(1000) == "bin"
    assert num_to_words(1923) == "bin dokuz yüz yirmi üç"
    assert num_to_words(1_000_000) == "bir milyon"
    assert num_to_words(44404) == "kırk dört bin dört yüz dört"
    assert ordinal_words(1) == "birinci" and ordinal_words(4) == "dördüncü" and ordinal_words(6) == "altıncı"
    assert ordinal_words(10) == "onuncu" and ordinal_words(100) == "yüzüncü" and ordinal_words(1000) == "bininci"


# ---- Parcalama -------------------------------------------------------------------------
def test_split_sentences_abbrev_safe():
    s = split_sentences("Dr. Ahmet geldi. 1. Dünya Savaşı bitti. Elma vb. şeyler. Son cümle.")
    assert s == ["Dr. Ahmet geldi.", "1. Dünya Savaşı bitti.", "Elma vb. şeyler.", "Son cümle."]


def test_split_paragraph_aligned():
    paras = [("Paragraf %d. " % i) + "Cümle burada. " * 20 for i in range(10)]
    text = "\n\n".join(p.strip() for p in paras)
    chunks = split_for_tts(text, max_chars=800)
    assert len(chunks) > 1
    for c in chunks:
        assert len(c) <= 800
        assert c.endswith(".")                      # paragraf sonunda biter
        assert not c.startswith("Cümle")           # paragraf basinda baslar
    assert "\n\n".join(chunks) == text


def test_split_long_single_paragraph():
    text = "Kısa cümle. " * 400
    chunks = split_for_tts(text.strip(), max_chars=500)
    assert all(len(c) <= 500 for c in chunks) and all(c.endswith(".") for c in chunks)
    assert " ".join(chunks) == text.strip()


# ---- Sessizlik / yonerge / sesler --------------------------------------------------------
def test_tail_silence_idempotent():
    pcm = b"\x01\x02" * 1000
    out = with_tail_silence(pcm)
    assert out.endswith(SILENCE_PCM) and len(out) == len(pcm) + len(SILENCE_PCM)
    assert with_tail_silence(out) == out
    assert len(SILENCE_PCM) == 24000             # 0.5 sn * 24000 Hz * 2 bayt


def test_directive_english_and_context():
    p = build_prompt("Merhaba.", part=2, total=4)
    assert p.startswith("Read the following Turkish text aloud")
    assert "part 2 of 4" in p and "\nTEXT:\nMerhaba." in p
    assert "Do not read these instructions aloud" in p
    assert part_context(1, 1) == "" and "final part" in part_context(4, 4)
    d = build_prompt("Ayşe: Selam.", dialog=True)
    assert "Turkish conversation" in d and "Kerem" in d


def test_voice_lists():
    assert len(FEMALE_VOICES) == 4 and len(MALE_VOICES) == 3
    assert normalize_voice("Achernar") in FEMALE_VOICES and normalize_voice("Fenrir", male=True) in MALE_VOICES
    assert normalize_voice(None) == "Sulafat" and normalize_voice("xyz", male=True) == "Puck"
