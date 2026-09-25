class AppError(Exception):
    code = "APP_ERROR"
    status = 400
    user_message = "İşlem tamamlanamadı. Sayfayı yenileyip tekrar dene; sürerse birkaç dakika bekle."

    def __init__(self, user_message: str | None = None, detail: str | None = None):
        if user_message:
            self.user_message = user_message
        self.detail = detail
        super().__init__(self.user_message)


class PdfUnreadable(AppError):
    code, status, user_message = "PDF_UNREADABLE", 422, "Bu PDF açılamadı; dosya bozuk olabilir. Başka bir dosya dene."


class PdfNoText(AppError):
    code, status = "PDF_NO_TEXT", 422
    user_message = "Bu PDF taranmış görünüyor; sayfalardaki yazıyı okumayı deniyorum."


class FileTooLarge(AppError):
    code, status, user_message = "FILE_TOO_LARGE", 413, "Dosya çok büyük. Dosyayı bölerek ya da sıkıştırarak yükle."


class AiUnavailable(AppError):
    code, status = "AI_UNAVAILABLE", 503
    user_message = "Yapay zekâ şu an yanıt veremiyor; birazdan tekrar dene."


class AiBusy(AiUnavailable):
    """Servis (sağlayıcı) tarafı dolu ya da yoğun: herkes için geçerli, kişinin hakkıyla ilgisi yok."""
    code, status = "AI_BUSY", 503
    user_message = "Yapay zekâ şu an yoğun; birkaç dakika sonra tekrar dene."


class UsageLimit(AiUnavailable):
    """Kişinin günlük yapay zekâ kullanımı doldu. AiUnavailable'dan türer ki
    mevcut `except AiUnavailable: raise` blokları bu hatayı yutmasın, olduğu gibi iletsin."""
    code, status = "USAGE_LIMIT", 429
    user_message = "Bugünkü yapay zekâ kullanımın doldu."


class RateLimit(AppError):
    code, status = "RATE_LIMIT", 429
    user_message = "Çok fazla deneme yaptın; birkaç dakika sonra tekrar dene."


class NotFound(AppError):
    code, status, user_message = "NOT_FOUND", 404, "Aradığın içerik bulunamadı; silinmiş olabilir."


class Unauthorized(AppError):
    code, status, user_message = ("UNAUTHORIZED", 401,
                                  "Bu içeriği görme iznin yok ya da oturumun kapanmış. Tekrar giriş yap.")
