class AppError(Exception):
    code = "APP_ERROR"
    status = 400
    user_message = "Bir hata oluştu."

    def __init__(self, user_message: str | None = None, detail: str | None = None):
        if user_message:
            self.user_message = user_message
        self.detail = detail
        super().__init__(self.user_message)


class PdfUnreadable(AppError):
    code, status, user_message = "PDF_UNREADABLE", 422, "Bu PDF açılamadı; dosya bozuk olabilir."


class PdfNoText(AppError):
    code, status = "PDF_NO_TEXT", 422
    user_message = "Bu PDF taranmış görünüyor. OCR ile metin çıkarmayı deneyelim mi?"


class FileTooLarge(AppError):
    code, status, user_message = "FILE_TOO_LARGE", 413, "Dosya boyutu sınırı aşıldı."


class AiUnavailable(AppError):
    code, status = "AI_UNAVAILABLE", 503
    user_message = "Asistan şu an yanıt veremiyor; birazdan tekrar deneyin."


class NotFound(AppError):
    code, status, user_message = "NOT_FOUND", 404, "Kayıt bulunamadı."


class Unauthorized(AppError):
    code, status, user_message = "UNAUTHORIZED", 401, "Yetkisiz erişim."
