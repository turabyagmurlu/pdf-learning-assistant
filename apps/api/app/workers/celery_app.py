from celery import Celery
from app.config import settings

celery = Celery("pdfapp", broker=settings.redis_url, backend=settings.redis_url)
celery.conf.update(task_track_started=True, task_time_limit=1800)

import app.workers.tasks  # noqa: E402,F401  (görevleri kaydet)
