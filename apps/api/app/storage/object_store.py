import boto3
from botocore.client import Config
from app.config import settings

_s3 = boto3.client(
    "s3",
    endpoint_url=settings.s3_endpoint.strip(),
    aws_access_key_id=settings.s3_access_key.strip(),
    aws_secret_access_key=settings.s3_secret_key.strip(),
    region_name=settings.s3_region.strip(),
    config=Config(signature_version="s3v4"),
)


def ensure_bucket():
    try:
        _s3.head_bucket(Bucket=settings.s3_bucket)
    except Exception:  # noqa
        _s3.create_bucket(Bucket=settings.s3_bucket)


def put_object(key: str, data: bytes, content_type="application/pdf"):
    _s3.put_object(Bucket=settings.s3_bucket, Key=key, Body=data, ContentType=content_type)


def get_object(key: str) -> bytes:
    r = _s3.get_object(Bucket=settings.s3_bucket, Key=key)
    return r["Body"].read()


def delete_object(key: str):
    _s3.delete_object(Bucket=settings.s3_bucket, Key=key)


def presigned_url(key: str, expires=3600) -> str:
    url = _s3.generate_presigned_url(
        "get_object", Params={"Bucket": settings.s3_bucket, "Key": key}, ExpiresIn=expires)
    # container-içi endpoint'i tarayıcının erişebileceği public endpoint'e çevir
    return url.replace(settings.s3_endpoint, settings.s3_public_endpoint)
