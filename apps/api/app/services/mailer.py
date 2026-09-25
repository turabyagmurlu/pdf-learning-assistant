"""E-posta gonderimi (Resend HTTP API).

Ortam degiskenleri: RESEND_API_KEY, MAIL_FROM, WEB_URL. Ucunden biri bos ise
e-posta "yapilandirilmamis" sayilir ve sifre sifirlama ucu 503 MAIL_NOT_CONFIGURED doner.
"""
import html
import logging

import httpx

from app.config import settings

log = logging.getLogger("mailer")

RESEND_URL = "https://api.resend.com/emails"


def mail_configured() -> bool:
    return bool(settings.resend_api_key.strip() and settings.mail_from.strip() and settings.web_url.strip())


async def send_mail(to: str, subject: str, html_body: str, text_body: str) -> bool:
    """Tek alici. Basarili ise True. Hata firlatmaz (arka planda calisir), loga yazar."""
    if not mail_configured():
        log.warning("mail: yapilandirilmamis, gonderilmedi")
        return False
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                RESEND_URL,
                headers={"Authorization": f"Bearer {settings.resend_api_key.strip()}",
                         "Content-Type": "application/json"},
                json={"from": settings.mail_from.strip(), "to": [to], "subject": subject,
                      "html": html_body, "text": text_body},
            )
        if r.status_code >= 300:
            # alici adresini loga yazma (kisisel veri); yalniz durum ve kisa govde
            log.error("mail: resend %s %s", r.status_code, r.text[:300])
            return False
        return True
    except Exception as e:  # noqa
        log.error("mail: gonderim hatasi %s", type(e).__name__)
        return False


def reset_link(token: str) -> str:
    return settings.web_url.strip().rstrip("/") + "/reset?token=" + token


async def send_password_reset(to: str, name: str | None, token: str, minutes: int) -> bool:
    link = reset_link(token)
    nm = (name or "").strip()[:80]
    greet_text = f"Merhaba {nm}," if nm else "Merhaba,"
    greet_html = html.escape(greet_text)
    subject = "TY PDF şifre sıfırlama bağlantın"
    text_body = (
        f"{greet_text}\n\n"
        f"TY PDF hesabın için şifre sıfırlama isteği aldık. Yeni şifre belirlemek için bu bağlantıyı aç:\n\n"
        f"{link}\n\n"
        f"Bağlantı {minutes} dakika geçerli ve yalnız bir kez kullanılabilir.\n"
        f"Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin; şifren değişmez.\n\n"
        f"TY PDF"
    )
    html_body = f"""<!doctype html><html lang="tr"><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1f1a17;line-height:1.55;max-width:520px;margin:0 auto;padding:24px">
<p style="font-size:15px">{greet_html}</p>
<p style="font-size:15px">TY PDF hesabın için şifre sıfırlama isteği aldık. Yeni şifre belirlemek için aşağıdaki düğmeye bas.</p>
<p style="margin:28px 0"><a href="{html.escape(link)}" style="background:#1f1a17;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;display:inline-block">Yeni şifre belirle</a></p>
<p style="font-size:13px;color:#6b625c">Düğme çalışmazsa bu adresi tarayıcına yapıştır:<br><span style="word-break:break-all">{html.escape(link)}</span></p>
<p style="font-size:13px;color:#6b625c">Bağlantı {minutes} dakika geçerli ve yalnız bir kez kullanılabilir. Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin; şifren değişmez.</p>
<p style="font-size:13px;color:#6b625c">TY PDF</p>
</body></html>"""
    return await send_mail(to, subject, html_body, text_body)
