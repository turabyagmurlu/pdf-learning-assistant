"""Gemini TTS ile dogal Turkce seslendirme.

Gemini TTS 24kHz, 16-bit, mono PCM dondurur. Varsayilan cikti artik MP3
(ffmpeg, 64 kb/s mono: WAV'in ~6'da biri); ffmpeg yoksa ya da hata verirse
WAV basligi eklenip olduğu gibi verilir.

V3 (T5-ses):
- `tts_prepare()`: TTS'e giden HER metin once buradan gecer (tire, atif, sekil/tablo,
  baslik/sayfa artiklari, kisaltma sozlugu, sayi -> yazi, noktalama). Kota yok, ~1 ms.
- `split_for_tts()`: paragraf hizali, kisaltma guvenli parcalama.
- `with_tail_silence()`: parca sonuna 500 ms sessizlik (PCM sifir).
- `pcm_to_mp3()`: `loudnorm` (-16 LUFS) ile seviye dengeleme.
- `build_directive()`: Ingilizce, ayrik, parca baglamli TTS yonergesi (tekli + sohbet ortak sablon).
- Ses listesi: Turkce icin 4 kadin + 3 erkek.
"""
import base64
import hashlib
import logging
import re
import shutil
import struct
import subprocess
import httpx
from app.config import settings
from app.core.errors import AiUnavailable
from app.ai import usage

BASE = "https://generativelanguage.googleapis.com/v1beta"
log = logging.getLogger(__name__)

PCM_RATE = 24000                       # Gemini TTS: 24 kHz, 16 bit, mono
WAV_HEADER_LEN = 44
MP3_BITRATE = "64k"
FORMATS = {"mp3": "audio/mpeg", "wav": "audio/wav"}
DEFAULT_FORMAT = "mp3"

# Parca sonu sessizligi: 500 ms, s16le mono 24 kHz -> 24000 bayt sifir
SILENCE_SEC = 0.5
SILENCE_PCM = b"\x00" * int(SILENCE_SEC * PCM_RATE * 2)

# Ses ornegi: her ses icin bir kez uretilir, `sample:<ses>:<format>` anahtariyla
# kalici saklanir (LectureTab'in gonderdigi cumleyle birebir ayni olmali).
# NOT: Bu cumle `tts_prepare` ile degismez (kisaltma/sayi yok); onbellek anahtari sabit kalir.
SAMPLE_TEXT = "Merhaba, bu defterdeki kaynakları sana bu sesle anlatacağım."


class TtsBusy(AiUnavailable):
    """Gemini modeli gecici olarak yogun (500/503/504). Beklenip tekrar denenir."""

    code, status = "TTS_BUSY", 503

    def __init__(self, user_message: str | None = None, retry_after: int = 8):
        super().__init__(user_message)
        self.retry_after = retry_after


class TtsQuota(AiUnavailable):
    """Gemini ses kotasi doldu (429). retry_after: onerilen bekleme (sn)."""

    code, status = "TTS_QUOTA", 429      # 503 degil: istemci bunu tekrar denemesin

    def __init__(self, user_message: str | None = None, retry_after: int = 30, daily: bool = False):
        super().__init__(user_message)
        self.retry_after = retry_after
        self.daily = daily


# ---- Sesler ---------------------------------------------------------------------------
# Turkce icin daraltilmis liste (T5-ses 2.4): etiketler kullanim amaciyla, kisa ve anlasilir.
# Sulafat varsayilan kalir (mevcut onbellekler gecersizlesmesin).
FEMALE_VOICES = {
    "Sulafat": "Sakin anlatıcı · varsayılan",
    "Kore": "Daha kararlı",
    "Aoede": "Daha canlı",
    "Zephyr": "Daha parlak",
}
DEFAULT_VOICE = "Sulafat"

MALE_VOICES = {
    "Puck": "Meraklı öğrenci · varsayılan",
    "Charon": "Daha tok",
    "Orus": "Daha kararlı",
}
DEFAULT_MALE_VOICE = "Puck"

# Eski listeden kalan tercihleri en yakin yeni sese esle (localStorage'da eski ad kalmis olabilir)
_LEGACY_FEMALE = {
    "Achernar": "Sulafat", "Vindemiatrix": "Sulafat", "Callirrhoe": "Sulafat", "Despina": "Sulafat",
    "Leda": "Aoede", "Laomedeia": "Aoede", "Sadachbia": "Aoede", "Autonoe": "Zephyr", "Erinome": "Zephyr",
    "Gacrux": "Kore", "Pulcherrima": "Kore",
}
_LEGACY_MALE = {
    "Fenrir": "Puck", "Achird": "Puck", "Enceladus": "Charon", "Algenib": "Charon",
    "Sadaltager": "Charon", "Iapetus": "Orus", "Schedar": "Orus",
}


def normalize_voice(voice: str | None, male: bool = False) -> str:
    """Bilinmeyen/eski ses adini listedeki en yakin sese ceker."""
    v = (voice or "").strip()
    if male:
        return v if v in MALE_VOICES else _LEGACY_MALE.get(v, DEFAULT_MALE_VOICE)
    return v if v in FEMALE_VOICES else _LEGACY_FEMALE.get(v, DEFAULT_VOICE)


# ---- WAV / ffmpeg -----------------------------------------------------------------------
def _wav_header(pcm_len: int, rate: int = 24000, channels: int = 1, bits: int = 16) -> bytes:
    byte_rate = rate * channels * bits // 8
    block_align = channels * bits // 8
    return (
        b"RIFF" + struct.pack("<I", 36 + pcm_len) + b"WAVE"
        + b"fmt " + struct.pack("<IHHIIHH", 16, 1, channels, rate, byte_rate, block_align, bits)
        + b"data" + struct.pack("<I", pcm_len)
    )


def wav_from_pcm(pcm: bytes) -> bytes:
    """Ham PCM'i calinabilir WAV'a cevirir."""
    return _wav_header(len(pcm)) + pcm


def pcm_from_wav(wav: bytes) -> bytes:
    """Bizim urettigimiz (44 baytlik sabit basliklı) WAV'dan PCM'i geri alir."""
    if wav[:4] == b"RIFF" and len(wav) > WAV_HEADER_LEN:
        return wav[WAV_HEADER_LEN:]
    return wav


def with_tail_silence(pcm: bytes, silence: bytes = SILENCE_PCM) -> bytes:
    """Parca sonuna 500 ms sessizlik ekler; zaten varsa (son baytlar sifir) dokunmaz.
    Idempotent: eski onbellek parcalari da sunumda ayni sessizligi alir."""
    if not pcm:
        return pcm
    n = len(silence)
    if len(pcm) >= n and not any(pcm[-n:]):
        return pcm
    # 16 bit hizasi: tek bayt kalmasin
    if len(pcm) % 2:
        pcm = pcm + b"\x00"
    return pcm + silence


_FFMPEG: str | None = None
_FFMPEG_CHECKED = False


def ffmpeg_path() -> str | None:
    """ffmpeg ikilisi (Dockerfile'da var); yoksa None -> WAV'a duselim."""
    global _FFMPEG, _FFMPEG_CHECKED
    if not _FFMPEG_CHECKED:
        _FFMPEG = shutil.which("ffmpeg")
        _FFMPEG_CHECKED = True
    return _FFMPEG


# Konusma icin podcast standardi: -16 LUFS, tepe -1.5 dBTP. Tek gecis yeterli.
LOUDNORM_FILTER = "loudnorm=I=-16:TP=-1.5:LRA=11"


def pcm_to_mp3(pcm: bytes, bitrate: str = MP3_BITRATE, normalize: bool = True) -> bytes | None:
    """PCM (s16le 24 kHz mono) -> MP3. ffmpeg yoksa/hata verirse None (cagiran WAV'a duser).

    `normalize=True`: loudnorm ile seviye dengelenir (iki ses / parcalar arasi fark kalkar).
    Filtre hata verirse filtresiz yeniden denenir. Boru uzerinden calisir, gecici dosya yok.
    Engelleyici oldugu icin `asyncio.to_thread` icinden cagrilmali.
    """
    exe = ffmpeg_path()
    if not exe or not pcm:
        return None
    for af in ([LOUDNORM_FILTER, None] if normalize else [None]):
        cmd = [exe, "-hide_banner", "-loglevel", "error", "-nostdin",
               "-f", "s16le", "-ar", str(PCM_RATE), "-ac", "1", "-i", "pipe:0"]
        if af:
            cmd += ["-af", af, "-ar", str(PCM_RATE)]
        cmd += ["-codec:a", "libmp3lame", "-b:a", bitrate, "-f", "mp3", "pipe:1"]
        try:
            p = subprocess.run(cmd, input=pcm, capture_output=True, timeout=120)
            if p.returncode == 0 and len(p.stdout) > 200:
                return p.stdout
            log.warning("ffmpeg mp3 basarisiz (rc=%s, af=%s): %s", p.returncode, af,
                        p.stderr[-300:].decode("utf-8", "ignore"))
        except Exception as e:  # noqa
            log.warning("ffmpeg mp3 calistirilamadi: %r", e)
    return None


def mp3_to_pcm(mp3: bytes) -> bytes | None:
    """MP3 -> PCM (s16le 24 kHz mono); yalniz eski istemci WAV isterse gerekir."""
    exe = ffmpeg_path()
    if not exe or not mp3:
        return None
    cmd = [exe, "-hide_banner", "-loglevel", "error", "-nostdin", "-i", "pipe:0",
           "-f", "s16le", "-ar", str(PCM_RATE), "-ac", "1", "pipe:1"]
    try:
        p = subprocess.run(cmd, input=mp3, capture_output=True, timeout=120)
        if p.returncode == 0 and p.stdout:
            return p.stdout
    except Exception:  # noqa
        pass
    return None


def normalize_format(fmt: str | None, accept: str | None = None) -> str:
    """Istemcinin istedigi format: `?fmt=` once, sonra Accept basligi, yoksa MP3."""
    f = (fmt or "").strip().lower()
    if f in ("mp3", "mpeg"):
        return "mp3"
    if f in ("wav", "wave"):
        return "wav"
    a = (accept or "").lower()
    if "audio/wav" in a and "audio/mpeg" not in a:
        return "wav"
    return DEFAULT_FORMAT


def encode_audio(pcm: bytes, fmt: str = DEFAULT_FORMAT) -> tuple[bytes, str, str]:
    """PCM'i istenen bicime kodlar -> (bayt, mime, gercek_format). MP3 olmazsa WAV."""
    if fmt == "mp3":
        mp3 = pcm_to_mp3(pcm)
        if mp3:
            return mp3, FORMATS["mp3"], "mp3"
    return wav_from_pcm(pcm), FORMATS["wav"], "wav"


def cache_key(text: str, voice: str, style: str = "") -> str:
    """Ayni metin+ses icin sabit anahtar; uretilen ses bir daha uretilmez.

    Format anahtara DAHIL DEGIL: cagiran `mp3:`/`wav:`/`pcm:` on ekiyle ayirir,
    boylece eski `wav:` kayitlari gecerli kalir (bkz. api/study.py).
    """
    h = hashlib.sha256()
    h.update((text or "").strip().encode("utf-8"))
    h.update(b"\x00" + (voice or "").encode("utf-8"))
    h.update(b"\x00" + (style or "").strip().encode("utf-8"))
    return h.hexdigest()


def sample_key(voice: str, fmt: str = DEFAULT_FORMAT) -> str:
    """Ses ornegi icin kalici anahtar (LRU temizliginde silinmez)."""
    return f"sample:{voice}:{fmt}"


def estimate_seconds(chars: int, sec_per_100: float = 1.0) -> int:
    """Kabaca uretim suresi: ~1 sn / 100 karakter (istemci kendi olcumuyle kalibre eder)."""
    return max(3, int(round(chars / 100.0 * sec_per_100)) + 2)


def _quota_from_response(r: httpx.Response) -> "TtsQuota":
    """429 govdesinden Google'in onerdigi bekleme suresini okur."""
    delay, daily, msg = 30, False, ""
    try:
        err = (r.json() or {}).get("error") or {}
        msg = (err.get("message") or "")[:300]
        for d in err.get("details") or []:
            if str(d.get("@type", "")).endswith("RetryInfo"):
                m = re.match(r"(\d+(?:\.\d+)?)s", str(d.get("retryDelay") or ""))
                if m:
                    delay = int(float(m.group(1))) + 1
            if str(d.get("@type", "")).endswith("QuotaFailure"):
                for v in d.get("violations") or []:
                    if "PerDay" in str(v.get("quotaId", "")):
                        daily = True
    except Exception:
        pass
    if "PerDay" in msg or "per day" in msg.lower():
        daily = True
    if daily:
        return TtsQuota("Seslendirme bugünlük doldu, yarın yeniden açılır. "
                        "Şimdilik cihaz sesiyle dinleyebilirsin.", retry_after=3600, daily=True)
    delay = max(5, min(delay, 90))
    return TtsQuota(f"Seslendirme şu an yoğun; {delay} saniye sonra kendiliğinden yeniden denenecek.",
                    retry_after=delay)


# =====================================================================================
# Sayi -> Turkce yazi
# =====================================================================================
_ONES = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"]
_TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"]
_SCALES = [(10 ** 12, "trilyon"), (10 ** 9, "milyar"), (10 ** 6, "milyon"), (1000, "bin")]
_VOWELS = "aeıioöuü"


def _under_1000(n: int) -> str:
    out = []
    h, r = divmod(n, 100)
    if h:
        out.append("yüz" if h == 1 else _ONES[h] + " yüz")
    t, o = divmod(r, 10)
    if t:
        out.append(_TENS[t])
    if o:
        out.append(_ONES[o])
    return " ".join(out)


def num_to_words(n: int) -> str:
    """Tam sayiyi Turkce yaziya cevirir (0 .. 10^15). 100 -> yüz, 1000 -> bin, 1.000.000 -> bir milyon."""
    if n < 0:
        return "eksi " + num_to_words(-n)
    if n == 0:
        return "sıfır"
    if n >= 10 ** 15:
        return str(n)
    parts = []
    for val, name in _SCALES:
        q, n = divmod(n, val)
        if q:
            parts.append(name if (q == 1 and val == 1000) else _under_1000(q) + " " + name)
    if n:
        parts.append(_under_1000(n))
    return " ".join(parts)


def _last_vowel(word: str) -> str:
    for ch in reversed(word):
        if ch in _VOWELS:
            return ch
    return "e"


def _harmony(v: str) -> str:
    if v in "aı":
        return "ı"
    if v in "ei":
        return "i"
    if v in "ou":
        return "u"
    return "ü"


def ordinal_words(n: int) -> str:
    """Sira sayisi: 1 -> birinci, 4 -> dördüncü, 100 -> yüzüncü, 1000 -> bininci."""
    w = num_to_words(n)
    if w.endswith("dört"):
        w = w[:-1] + "d"
    hv = _harmony(_last_vowel(w))
    if w[-1] in _VOWELS:
        return w + "nc" + hv
    return w + hv + "nc" + hv


def _soften(words: str, suffix: str) -> str:
    """'dört' + unlu ek -> 'dörd' (dördü, dörde)."""
    if suffix and suffix[0] in _VOWELS and words.endswith("dört"):
        return words[:-1] + "d"
    return words


# =====================================================================================
# tts_prepare: dinleme icin metin on isleme
# =====================================================================================
_TR_LOWER = "a-zçğıöşüâîû"
_TR_UPPER = "A-ZÇĞİÖŞÜÂÎÛ"

# 5) Kisaltma sozlugu (sira onemli: uzun kaliplar once). Anahtarlar regex.
_ABBREV: list[tuple[str, str]] = [
    (r"\bProf\.\s*Dr\.", "Profesör Doktor"),
    (r"\bDoç\.\s*Dr\.", "Doçent Doktor"),
    (r"\bYrd\.\s*Doç\.(\s*Dr\.)?", "Yardımcı Doçent"),
    (r"\bDr\.\s*Öğr\.\s*Üyesi", "Doktor Öğretim Üyesi"),
    (r"\bÖğr\.\s*Gör\.", "Öğretim Görevlisi"),
    (r"\bArş\.\s*Gör\.", "Araştırma Görevlisi"),
    (r"\bProf\.", "Profesör"),
    (r"\bDoç\.", "Doçent"),
    (r"\bDr\.", "Doktor"),
    (r"\bAv\.", "Avukat"),
    (r"\bOp\.\s*Dr\.", "Operatör Doktor"),
    (r"\bUzm\.", "Uzman"),
    (r"\bM\.\s*Ö\.|\bMÖ\b(?=\s*\d)", "milattan önce"),
    (r"\bM\.\s*S\.|\bMS\b(?=\s*\d)", "milattan sonra"),
    (r"\bT\.\s*C\.", "Türkiye Cumhuriyeti"),
    (r"\bHz\.", "Hazreti"),
    (r"\bvb\.|\bv\.b\.|\bvb\b", "ve benzeri"),
    (r"\bvs\.|\bv\.s\.|\bvs\b", "vesaire"),
    (r"\bvd\.", "ve diğerleri"),
    (r"\bve\s+ark\.", "ve arkadaşları"),
    (r"\bark\.", "arkadaşları"),
    (r"\byy\.", "yüzyıl"),
    (r"\börn\.|\bör\.", "örneğin"),
    (r"\byak\.", "yaklaşık"),
    (r"\bkrş\.", "karşılaştır"),
    (r"\bçev\.", "çeviren"),
    (r"\bed\.", "editör"),
    (r"\bhaz\.", "hazırlayan"),
    (r"\byay\.", "yayınları"),
    (r"\bYay\.", "Yayınları"),
    (r"\bÜniv\.", "Üniversitesi"),
    (r"\bFak\.", "Fakültesi"),
    (r"\bEnst\.", "Enstitüsü"),
    (r"\bAns\.", "Ansiklopedisi"),
    (r"\bBöl\.|\bBl\.", "Bölüm"),
    (r"\bmad\.|\bmd\.", "madde"),
    (r"\bc\.(?=\s*\d)", "cilt"),
    (r"\bNo\.|\bNr\.", "numara"),
    (r"\bTel\.", "telefon"),
    (r"\bCad\.", "Caddesi"),
    (r"\bSok\.|\bSk\.", "Sokak"),
    (r"\bMah\.", "Mahallesi"),
    (r"\bApt\.", "Apartmanı"),
    (r"\bBulv\.", "Bulvarı"),
    (r"\bdk\.", "dakika"),
    (r"\bsn\.", "saniye"),
    (r"\bSn\.", "Sayın"),
    (r"\bsa\.(?=\s*\d)", "saat"),
    (r"\bİng\.", "İngilizce"),
    (r"\bFr\.", "Fransızca"),
    (r"\bAlm\.", "Almanca"),
    (r"\bLat\.", "Latince"),
    (r"\bAr\.", "Arapça"),
    (r"\bFar\.", "Farsça"),
    (r"\bOsm\.", "Osmanlıca"),
    (r"\bYun\.", "Yunanca"),
    (r"\bvb\b", "ve benzeri"),
    (r"(\d)\s*km²", r"\1 kilometrekare"),
    (r"(\d)\s*m²", r"\1 metrekare"),
    (r"(\d)\s*km\b", r"\1 kilometre"),
    (r"(\d)\s*cm\b", r"\1 santimetre"),
    (r"(\d)\s*mm\b", r"\1 milimetre"),
    (r"(\d)\s*kg\b", r"\1 kilogram"),
    (r"(\d)\s*°C", r"\1 derece"),
    (r"(\d)\s*TL\b", r"\1 lira"),
    (r"\bTL\b", "lira"),
    (r"%\s*(\d)", r"yüzde \1"),
    (r"(\d)\s*%", r"\1 yüzde"),
]
_ABBREV_RE = [(re.compile(p), r) for p, r in _ABBREV]

# Kisaltma acilimlarindan sonra kalan kesme isaretleri: "yüzyıl'ın" -> "yüzyılın"
_EXPANDED_APOS = re.compile(r"\b(yüzyıl|lira|derece|kilometrekare|metrekare|kilometre|santimetre|milimetre|kilogram|"
                            r"dakika|saniye|saat|madde|cilt|numara)['’]([" + _TR_LOWER + "]+)")

# 3) Gorsel referanslari
_VISUAL_PAREN = re.compile(r"\(\s*(?:bkz\.?|bk\.|a\.g\.e\.|age\.)[^()]*\)", re.IGNORECASE)
# "bkz." + hemen ardindaki tek hedef (Sekil 3 / Tablo 2 / s. 45 / Ek 1 / Bolum 3). Eski desen ilk noktalamaya
# kadar her seyi siliyordu: "Bkz. Şekil 3 ve Tablo 2'de görüldüğü gibi sonuçlar arttı" cumlesi tumden kayboluyordu
# (V tur 2). Hedef sonrasi kalan "ve Tablo 2'de görüldüğü gibi" parcasini _VISUAL_REF temizler.
_VISUAL_BKZ = re.compile(
    r"\b(?:bkz|bk)\.?\s*"
    r"(?:(?:Şekil|Tablo|Grafik|Resim|Harita|Çizelge|Fotoğraf|Görsel|Diyagram|Ek|Bölüm|Dipnot|Not|sayfa|sf\.|ss?\.)"
    r"\s*\d*(?:\.\d+)?(?:\s*[-–]\s*\d+)?(?:['’][" + _TR_LOWER + r"]+)?\s*)?",
    re.IGNORECASE)
_VISUAL_REF = re.compile(
    r"\b(?:Şekil|Tablo|Grafik|Resim|Harita|Çizelge|Fotoğraf|Görsel|Diyagram)\s*\d+(?:\.\d+)?"
    r"(?:['’][" + _TR_LOWER + r"]+)?\s*"
    r"(?:(?:görüldüğü|gösterildiği|verildiği|belirtildiği|izlendiği|özetlendiği)\s+(?:gibi|üzere)|verilen|sunulan|gösterilen)?"
    r"\s*,?\s*", re.IGNORECASE)
_PAGE_REF = re.compile(r"\b(?:ss?\.|sayfa|sf\.)\s*\d+(?:\s*[-–]\s*\d+)?\s*[.,;]?\s*", re.IGNORECASE)
_AGE = re.compile(r"\b(?:a\.\s*g\.\s*e\.|age\.|a\.\s*g\.\s*m\.|agm\.|ibid\.?|op\.\s*cit\.)\s*", re.IGNORECASE)

# 2) Atif ve dipnot
_CIT_NUM = re.compile(r"\(\s*\d{1,3}(?:\s*[,;–-]\s*\d{1,3})*\s*\)")
_CIT_BRACKET = re.compile(r"\[\s*\d+(?:\s*[,;–-]\s*\d+)*\s*\]")
_CIT_YEAR_PAREN = re.compile(r"\(\s*\d{4}[a-z]?(?:\s*[:;,]\s*[\d\s,;–-]+)?\s*\)")
_CIT_YEAR_RANGE = re.compile(r"\(\s*(\d{4})\s*[-–]\s*(\d{4})\s*\)")
_CIT_AUTHOR = re.compile(
    r"\(\s*(?:[" + _TR_UPPER + r"][^()]{0,40}?,?\s*(?:vd\.|ve ark\.|et al\.?)?\s*,?\s*\d{4}[a-z]?"
    r"(?:\s*[:;,]\s*[\d\s,;–-]+)?)(?:\s*;[^()]{1,60})*\s*\)")
_SUPERSCRIPT = re.compile(r"[⁰¹²³⁴⁵⁶⁷⁸⁹]+")
_GLUED_FOOTNOTE = re.compile(r"([" + _TR_LOWER + r"\)\]\"”’][.!?,;])(\d{1,2})(?=\s|$)")

# 4) Satir duzeyi artiklar
_LINE_ONLY_NUM = re.compile(r"^\s*[-–]?\s*\d{1,4}\s*[-–]?\s*$")
_LINE_META = re.compile(r"ISSN|ISBN|DOI\b|doi:|https?://|www\.", re.IGNORECASE)
_LINE_TABLE = re.compile(r"\||\t.*\t")
_LINE_NUMCOLS = re.compile(r"^\s*(?:[-+]?\d[\d.,%]*\s+){3,}[-+]?\d[\d.,%]*\s*$")
_LINE_FOOTNOTE = re.compile(r"^\s*(?:[⁰¹²³⁴⁵⁶⁷⁸⁹]+|\d{1,2}\s*[)\]])\s*\S")
_LINE_LIST = re.compile(r"^\s*(?:\d{1,2}[.)]|[-–•*▪●])\s+")
_LINE_LIST_NUM = re.compile(r"^\s*(\d{1,2})[.)]\s+(\S+)")
_LINE_HEADING_MD = re.compile(r"^\s*#{1,6}\s*")

# 1) Tireler
_HYPHEN_EOL = re.compile(r"(\w)-\s*\n\s*(\w)")
_HYPHEN_SPACE = re.compile(r"([" + _TR_LOWER + r"])-\s+([" + _TR_LOWER + r"])")
_HYPHEN_TIGHT = re.compile(r"([" + _TR_LOWER + r"])-([" + _TR_LOWER + r"])")

# 6) Sayilar
_ORDINAL_CAPS = {"Dünya", "Cumhuriyet", "Meşrutiyet", "Bölüm", "Kısım", "Madde", "Yüzyıl", "Ordu", "Haçlı",
                 "Murat", "Mehmet", "Selim", "Bayezid", "Beyazıt", "Ahmet", "Mustafa", "Osman", "Abdülhamit",
                 "Abdülhamid", "Mahmut", "Süleyman", "Kolordu", "Tümen", "Sınıf", "Kat", "Ünite", "Basamak",
                 "Fasıl", "Perde", "Sahne", "Cilt", "Baskı", "Aşama", "Adım", "Evre", "Nesil", "Kuşak", "Beş",
                 "Dönem", "Yarıyıl", "Çeyrek", "Yarı", "Tur", "Lig", "Dalga", "Kongre", "Kurultay", "Sezon"}
_NUM_THOUSANDS = re.compile(r"\b\d{1,3}(?:\.\d{3})+\b(?!\.\d)")
_NUM_DECIMAL_COMMA = re.compile(r"\b(\d+),(\d+)\b")
_NUM_DECIMAL_DOT = re.compile(r"\b(\d+)\.(\d+)\b")
_NUM_RANGE = re.compile(r"\b(\d+)\s*[-–]\s*(\d+)\b(\s+(?:arasında|arası|arasını|arasındaki|yılları|yıllarında|yılları\s+arasında))?")
_NUM_TIME = re.compile(r"\b(\d{1,2}):(\d{2})\b")
_NUM_ORD_SUFFIX = re.compile(r"\b(\d+)['’]?\s*(?:inci|ıncı|uncu|üncü|nci|ncı|ncu|ncü)\b")
_NUM_ORD_DOT = re.compile(r"\b(\d+)\.\s+(?=([" + _TR_UPPER + _TR_LOWER + r"]+))")
_NUM_APOS = re.compile(r"\b(\d+)['’]([" + _TR_LOWER + r"]+)")
_NUM_PLAIN = re.compile(r"\b\d+\b")
_NUM_MARK = "⁣"   # gecici isaret: cevrilen sayi kelimelerini korur (invisible separator)

# 7) Noktalama
_DASHES = re.compile(r"\s*[—–]\s*")
_COLON_LOWER = re.compile(r":\s+(?=[" + _TR_LOWER + r"\d])")
_COLON_UPPER = re.compile(r":\s+(?=[" + _TR_UPPER + r"])")
_QUOTES = re.compile(r"[\"“”«»„‟]")
_ELLIPSIS = re.compile(r"…|\.{3,}")
_MD_MARKS = re.compile(r"[*_#`~]+")
_GLUED_SENT = re.compile(r"([" + _TR_LOWER + r"\d])\.([" + _TR_UPPER + r"])")
_GLUED_COMMA = re.compile(r"([" + _TR_LOWER + r"\d]),([" + _TR_UPPER + _TR_LOWER + r"])")
_PAREN_KEEP = re.compile(r"\(\s*([^()]{1,160}?)\s*\)")
_SPACES = re.compile(r"[ \t   ]+")
_PUNCT_SPACE = re.compile(r"\s+([.,;!?])")
_DUP_PUNCT = re.compile(r"([,;])\s*(?:[,;]\s*)+")
_COMMA_DOT = re.compile(r"[,;]\s*([.!?])")
_LEAD_PUNCT = re.compile(r"^\s*[,;.]+\s*")
_END_PUNCT = re.compile(r"[.!?]$")


def _is_heading_line(ln: str) -> bool:
    s = ln.strip()
    if len(s) > 80:
        return False
    letters = [c for c in s if c.isalpha()]
    if len(letters) < 3:
        return False
    return not any(c.islower() for c in letters)


def _clean_lines(text: str) -> str:
    """Satir duzeyi artiklar: sayfa no, TUMU BUYUK baslik, DOI/ISSN/url, tablo, dipnot satiri, liste isaretleri."""
    out: list[str] = []
    for raw in text.split("\n"):
        ln = raw.rstrip()
        if not ln.strip():
            out.append("")
            continue
        if _LINE_ONLY_NUM.match(ln) or _LINE_META.search(ln) or _LINE_TABLE.search(ln) \
                or _LINE_NUMCOLS.match(ln) or _LINE_FOOTNOTE.match(ln) or _is_heading_line(ln):
            continue
        ln = _LINE_HEADING_MD.sub("", ln)
        # Liste isareti ("1. Giriş", "- madde") kalkar; "1. Dünya Savaşı" gibi sira sayilari kalir
        m = _LINE_LIST_NUM.match(ln)
        if m and m.group(2) in _ORDINAL_CAPS:
            pass
        else:
            ln = _LINE_LIST.sub("", ln)
        out.append(ln)
    return "\n".join(out)


def _dehyphenate(text: str) -> str:
    text = _HYPHEN_EOL.sub(r"\1\2", text)
    text = _HYPHEN_SPACE.sub(r"\1\2", text)
    text = _HYPHEN_TIGHT.sub(r"\1\2", text)
    return text


def _strip_citations(text: str) -> str:
    text = _SUPERSCRIPT.sub("", text)
    text = _CIT_BRACKET.sub("", text)
    text = _CIT_NUM.sub("", text)
    text = _CIT_YEAR_RANGE.sub(lambda m: f", {m.group(1)}-{m.group(2)},", text)
    text = _CIT_AUTHOR.sub("", text)
    text = _CIT_YEAR_PAREN.sub("", text)
    text = _GLUED_FOOTNOTE.sub(r"\1", text)
    return text


def _strip_visual_refs(text: str) -> str:
    text = _VISUAL_PAREN.sub("", text)
    text = _VISUAL_BKZ.sub("", text)
    text = _VISUAL_REF.sub("", text)
    text = _PAGE_REF.sub("", text)
    text = _AGE.sub("", text)
    return text


def _expand_abbrev(text: str) -> str:
    for rx, rep in _ABBREV_RE:
        text = rx.sub(rep, text)
    text = _EXPANDED_APOS.sub(r"\1\2", text)
    return text


def _words(n_str: str) -> str:
    try:
        return num_to_words(int(n_str))
    except (ValueError, OverflowError):
        return n_str


def _mark(s: str) -> str:
    """Cevrilmis kelimeleri isaretler ki sonraki sayi kurallari yeniden dokunmasin."""
    return _NUM_MARK + s + _NUM_MARK


def _numbers_to_words(text: str) -> str:
    # saat 14:30
    text = _NUM_TIME.sub(lambda m: _mark(_words(m.group(1)) + " " + _words(m.group(2))), text)
    # binlik ayirici 37.521 -> 37521 (yalniz 3'lu gruplar)
    text = _NUM_THOUSANDS.sub(lambda m: m.group(0).replace(".", ""), text)
    # ondalik 12,5 -> on iki virgül beş ; 16.5 -> on altı nokta beş
    text = _NUM_DECIMAL_COMMA.sub(lambda m: _mark(_words(m.group(1)) + " virgül " + _words(m.group(2))), text)
    text = _NUM_DECIMAL_DOT.sub(lambda m: _mark(_words(m.group(1)) + " nokta " + _words(m.group(2))), text)
    # aralik 1550-1600 (arasında) -> bin beş yüz elli ile bin altı yüz arasında
    def _range(m):
        a, b, tail = _words(m.group(1)), _words(m.group(2)), m.group(3)
        return _mark(f"{a} ile {b}") + (tail if tail else " arası")
    text = _NUM_RANGE.sub(_range, text)
    # sira sayisi: 3'üncü / 1'inci
    text = _NUM_ORD_SUFFIX.sub(lambda m: _mark(ordinal_words(int(m.group(1)))), text)
    # sira sayisi: "16. yüzyıl", "1. Dünya Savaşı" (sonraki sozcuk kucuk harfli ya da bilinen buyuk harfli ad)
    def _ord_dot(m):
        nxt = m.group(2)
        if nxt[0].islower() or nxt in _ORDINAL_CAPS:
            return _mark(ordinal_words(int(m.group(1)))) + " "
        return m.group(0)
    text = _NUM_ORD_DOT.sub(_ord_dot, text)
    # ekli sayi: 1527'de -> bin beş yüz yirmi yedide ; 44404'e -> kırk dört bin dört yüz dörde
    text = _NUM_APOS.sub(lambda m: _mark(_soften(_words(m.group(1)), m.group(2)) + m.group(2)), text)
    # kalan tam sayilar
    text = _NUM_PLAIN.sub(lambda m: _mark(_words(m.group(0))) if len(m.group(0)) <= 15 else m.group(0), text)
    return text.replace(_NUM_MARK, "")


def _punctuation(text: str) -> str:
    text = _MD_MARKS.sub("", text)
    text = _QUOTES.sub("", text)
    text = _ELLIPSIS.sub(".", text)
    text = _DASHES.sub(", ", text)
    text = _PAREN_KEEP.sub(r", \1,", text)
    text = re.sub(r"[()\[\]{}]", "", text)
    text = _COLON_UPPER.sub(". ", text)
    text = _COLON_LOWER.sub(", ", text)
    text = _GLUED_SENT.sub(r"\1. \2", text)
    text = _GLUED_COMMA.sub(r"\1, \2", text)
    text = _SPACES.sub(" ", text)
    text = _PUNCT_SPACE.sub(r"\1", text)
    text = _DUP_PUNCT.sub(r"\1 ", text)
    text = _COMMA_DOT.sub(r"\1", text)
    text = _SPACES.sub(" ", text)
    text = _LEAD_PUNCT.sub("", text)
    text = text.strip()
    # Cumle basi buyuk harf (silinen "Şekil 2'de görüldüğü gibi" sonrasi kucuk kalmasin)
    text = _SENT_START_LOWER.sub(lambda m: m.group(1) + _tr_upper(m.group(2)), text)
    if text and text[0].islower():
        text = _tr_upper(text[0]) + text[1:]
    return text


_SENT_START_LOWER = re.compile(r"([.!?] )([" + _TR_LOWER + r"])")


def _tr_upper(ch: str) -> str:
    return "İ" if ch == "i" else ch.upper()


def _prepare_paragraph(p: str) -> str:
    p = _strip_citations(p)
    p = _strip_visual_refs(p)
    p = _expand_abbrev(p)
    p = _numbers_to_words(p)
    p = _punctuation(p)
    if p and not _END_PUNCT.search(p):
        p += "."
    return p


_DIALOG_LINE = re.compile(r"^\s*(Ayşe|Ayse|Kerem)\s*:\s*(.*)$", re.IGNORECASE)


def tts_prepare(text: str, dialog: bool = False) -> str:
    """Metni dinlenmek icin hazirlar (TTS ve cumle vurgusu ayni metni kullanir).

    Sira: satir artiklari -> tireler -> paragraflar -> (atif, gorsel ref, kisaltma, sayi, noktalama).
    `dialog=True`: 'Ayşe: …' / 'Kerem: …' satir etiketleri korunur, yalniz govde islenir.
    Kota yok; saf regex. Idempotent sayilir (ikinci gecis metni degistirmez).
    """
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n").replace("­", "")
    if not text.strip():
        return ""
    if dialog:
        out: list[str] = []
        for ln in text.split("\n"):
            if not ln.strip():
                continue
            m = _DIALOG_LINE.match(ln)
            if m:
                who = "Kerem" if m.group(1).lower().startswith("k") else "Ayşe"
                body = _prepare_paragraph(_dehyphenate(m.group(2)))
                if body:
                    out.append(f"{who}: {body}")
            else:
                body = _prepare_paragraph(_dehyphenate(ln))
                if body:
                    out.append(body)
        return "\n".join(out)
    text = _clean_lines(text)
    text = _dehyphenate(text)
    paras = []
    for block in re.split(r"\n\s*\n", text):
        joined = _SPACES.sub(" ", block.replace("\n", " ")).strip()
        if not joined:
            continue
        p = _prepare_paragraph(joined)
        if p and any(c.isalpha() for c in p):
            paras.append(p)
    return "\n\n".join(paras)


# =====================================================================================
# Parcalama (paragraf hizali, kisaltma guvenli)
# =====================================================================================
# Cumle siniri: noktalama + bosluk + buyuk harf; "vb. ", "Dr. ", "1. " gibi noktalarda bolmez.
_SENT_SPLIT = re.compile(
    r"(?<=[.!?…])(?<!\bvb\.)(?<!\bvs\.)(?<!\byy\.)(?<!\bDr\.)(?<!\bbkz\.)(?<!\börn\.)(?<!\bProf\.)"
    r"(?<!\bDoç\.)(?<!\bvd\.)(?<!\bark\.)(?<!\bÖ\.)(?<!\bS\.)(?<!\d\.)\s+(?=[" + _TR_UPPER + r"\d\"“(])")


def split_sentences(text: str) -> list[str]:
    return [s for s in (x.strip() for x in _SENT_SPLIT.split(text or "")) if s]


def _split_long(text: str, max_chars: int) -> list[str]:
    """Tek paragraf max_chars'i asarsa cumle sinirindan boler; tek cumle de asarsa bosluktan keser."""
    chunks, cur = [], ""
    for sent in split_sentences(text):
        if len(cur) + len(sent) + 1 <= max_chars:
            cur = (cur + " " + sent).strip()
        else:
            if cur:
                chunks.append(cur)
            while len(sent) > max_chars:
                cut = sent.rfind(" ", 0, max_chars)
                cut = cut if cut > max_chars // 2 else max_chars
                chunks.append(sent[:cut].strip())
                sent = sent[cut:].strip()
            cur = sent
    if cur:
        chunks.append(cur)
    return chunks


def split_for_tts(text: str, max_chars: int = 2600) -> list[str]:
    """Metni paragraf butunlugunu koruyarak ~max_chars'lik parcalara boler.

    Once paragraflara (`\\n\\n`) ayrilir; paragraflar sinira kadar toplanir, parca sinirlari
    hep paragraf sonuna duser. Tek paragraf siniri asarsa cumleden bolunur (kisaltma guvenli).
    Parca ne kadar buyukse o kadar az Gemini cagrisi -> kota o kadar az yanar.
    """
    text = (text or "").strip()
    if not text:
        return []
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    cur = ""
    for p in paras:
        if len(p) > max_chars:
            if cur:
                chunks.append(cur)
                cur = ""
            chunks.extend(_split_long(p, max_chars))
            continue
        if cur and len(cur) + 2 + len(p) > max_chars:
            chunks.append(cur)
            cur = p
        else:
            cur = (cur + "\n\n" + p) if cur else p
    if cur:
        chunks.append(cur)
    return chunks


# =====================================================================================
# Gemini TTS yonergesi (Ingilizce, ayrik, parca baglamli)
# =====================================================================================
_DIRECTIVE_SOLO = (
    "Read the following Turkish text aloud as a warm, calm, confident teacher speaking to one student. "
    "Natural conversational pace (about 150 words per minute), clear articulation of Turkish vowels "
    "(ı, ö, ü) and consonants (ş, ğ, ç). Pause briefly (about half a second) at paragraph breaks, "
    "a little longer before sentences that begin with \"Şimdi\", \"Peki\", \"Özetle\". "
    "Slightly emphasize the key noun of each sentence; do not sound monotone, but never theatrical."
)
_DIRECTIVE_DIALOG = (
    "Read the following Turkish conversation aloud. {a} is a warm, calm, confident teacher; "
    "{b} is a curious student who asks short questions and sometimes sounds surprised. "
    "Natural conversational pace, clear articulation of Turkish vowels (ı, ö, ü) and consonants (ş, ğ, ç). "
    "Leave a short pause between speaker turns; lively but never theatrical."
)
_DIRECTIVE_TAIL = "Do not read these instructions aloud; start directly with the text."


def part_context(part: int | None, total: int | None) -> str:
    """Parca konumu cumlesi: parca baslarinda 'yeniden baslama' tonunu azaltir."""
    if not part or not total or total <= 1:
        return ""
    if part == 1:
        return (f"This is part 1 of {total} of a longer lecture; it continues after this part, "
                "so do not add a closing or farewell at the end.")
    if part >= total:
        return (f"This is the final part ({part} of {total}) of a longer lecture; continue in the same tone "
                "as before, do not add an introduction at the start.")
    return (f"This is part {part} of {total} of a longer lecture; continue in the same tone as before, "
            "do not add an introduction or closing.")


def build_directive(style: str = "", part: int | None = None, total: int | None = None,
                    dialog: bool = False, speaker_a: str = "Ayşe", speaker_b: str = "Kerem") -> str:
    """Tekli ve sohbet icin ortak sablon. `style` verilirse ana cumlenin yerine gecer (ayni kuyruk)."""
    base = (style or "").strip() or (_DIRECTIVE_DIALOG.format(a=speaker_a, b=speaker_b) if dialog else _DIRECTIVE_SOLO)
    ctx = part_context(part, total)
    return " ".join(x for x in (base, ctx, _DIRECTIVE_TAIL) if x)


def build_prompt(text: str, style: str = "", part: int | None = None, total: int | None = None,
                 dialog: bool = False) -> str:
    """Yonerge + 'TEXT:' + metin; metin yeni satirla ayrilir (tirnak/ayrac icinde degil)."""
    return f"{build_directive(style, part, total, dialog)}\nTEXT:\n{text[:8000]}"


def _tts_models() -> list[str]:
    first = (settings.gemini_tts_model or "gemini-2.5-flash-preview-tts").strip()
    return list(dict.fromkeys([first, "gemini-2.5-flash-tts", "gemini-2.5-flash-preview-tts",
                               "gemini-2.5-pro-preview-tts", "gemini-2.5-pro-tts"]))


def gemini_audio(payload: dict, chars: int) -> bytes:
    """Ses modeli havuzu uzerinden tek cagri; ham PCM dondurur. tts_jobs ile ortak."""
    key = (settings.gemini_api_key or "").strip()
    if not key:
        # yapilandirma eksik (GEMINI_API_KEY); ayrinti kullaniciya degil loga
        raise AiUnavailable("Seslendirme şu an kullanılamıyor. Cihaz sesiyle dinleyebilirsin.",
                            detail="GEMINI_API_KEY tanimli degil")
    try:
        # Ses modeli havuzu: biri gunluk kotayi doldurursa digerine gec (her birinin ayri kotasi var)
        r = None
        quota_err = None
        model = ""
        usage.check_user()
        for model in _tts_models():
            if not usage.available(model):
                continue
            url = f"{BASE}/models/{model}:generateContent?key={key}"
            r = httpx.post(url, json=payload, timeout=httpx.Timeout(connect=10, read=170, write=30, pool=10))
            if r.status_code == 404:
                usage.mark_dead(model); r = None; continue
            if r.status_code == 429:
                quota_err = _quota_from_response(r)
                usage.mark_limited(model, getattr(quota_err, "daily", False), getattr(quota_err, "retry_after", None))
                r = None; continue
            break
        if r is None:
            if quota_err is None and any(usage.status(m) == "gunluk_doldu" for m in _tts_models()):
                quota_err = TtsQuota("Seslendirme bugünlük doldu, yarın yeniden açılır. "
                                     "Şimdilik cihaz sesiyle dinleyebilirsin.", daily=True)
            raise quota_err or TtsQuota("Seslendirme şu an yoğun; biraz sonra tekrar dene ya da cihaz sesiyle dinle.")
        if r.status_code in (500, 502, 503, 504):
            raise TtsBusy("Seslendirme şu an yoğun; birkaç saniye içinde yeniden denenecek.")
        if r.status_code >= 400:
            detail = ""
            try:
                detail = (r.json().get("error") or {}).get("message", "")[:160]
            except Exception:
                pass
            raise AiUnavailable("Seslendirme şu an yapılamadı; biraz sonra tekrar dene ya da cihaz sesiyle dinle.",
                                detail=f"tts {r.status_code}: {detail}")
        usage.record(model, "ses", chars)       # karakter bazli (T5 4.3)
        data = r.json()
        parts = data["candidates"][0]["content"]["parts"]
        for p in parts:
            inline = p.get("inlineData") or p.get("inline_data")
            if inline and inline.get("data"):
                return base64.b64decode(inline["data"])
        raise AiUnavailable("Seslendirme şu an yapılamadı; biraz sonra tekrar dene ya da cihaz sesiyle dinle.",
                            detail="tts: bos ses verisi")
    except AiUnavailable:
        raise
    except httpx.TimeoutException:
        raise AiUnavailable("Seslendirme çok uzun sürdü. Metni kısaltıp tekrar dene.")
    except Exception:  # noqa
        raise AiUnavailable("Seslendirme şu an yapılamadı; biraz sonra tekrar dene ya da cihaz sesiyle dinle.")


def synthesize_pcm(text: str, voice: str = DEFAULT_VOICE, style: str = "",
                   part: int | None = None, total: int | None = None) -> bytes:
    """Metni ham PCM baytlarina cevirir (tek Gemini cagrisi). Sonuna 500 ms sessizlik eklenir.

    `part`/`total`: parca konumu; yalniz yonergeye girer, onbellek anahtarina girmez.
    Metnin `tts_prepare`'den gecmis olmasi beklenir (cagiran yollar bunu yapar)."""
    voice = normalize_voice(voice)
    payload = {
        "contents": [{"parts": [{"text": build_prompt(text, style, part, total)}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}
            },
        },
    }
    return with_tail_silence(gemini_audio(payload, len(text)))


def synthesize_pcm_retry(text: str, voice: str = DEFAULT_VOICE, style: str = "") -> bytes:
    """Tek parca PCM (kisa metinler icin); gecici yogunlukta kendi kendine tekrar dener."""
    import time as _time
    last: Exception | None = None
    for attempt in range(3):
        try:
            return synthesize_pcm(text, voice, style)
        except TtsBusy as e:
            last = e
            if attempt < 2:
                _time.sleep(e.retry_after)
        except Exception:  # noqa - kota ve diger hatalar dogrudan yukari
            raise
    raise last or AiUnavailable("Seslendirme şu an yapılamadı; biraz sonra tekrar dene ya da cihaz sesiyle dinle.")


def synthesize(text: str, voice: str = DEFAULT_VOICE, style: str = "") -> bytes:
    """Geriye uyum: tek parca WAV."""
    return wav_from_pcm(synthesize_pcm_retry(text, voice, style))


def synthesize_audio(text: str, voice: str = DEFAULT_VOICE, style: str = "",
                     fmt: str = DEFAULT_FORMAT) -> tuple[bytes, str, str]:
    """Tek parca ses, istenen bicimde -> (bayt, mime, gercek_format)."""
    return encode_audio(synthesize_pcm_retry(text, voice, style), fmt)
