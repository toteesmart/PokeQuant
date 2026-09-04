import os
import boto3
from botocore.config import Config

R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME", "pokequant-db")

s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    config=Config(signature_version="s3v4"),
    region_name="auto"
)

s3.upload_file(
    "mobile_catalog.db",
    R2_BUCKET_NAME,
    "mobile_catalog.db",
    ExtraArgs={"ContentType": "application/octet-stream", "CacheControl": "no-cache, no-store, must-revalidate"}
)
print("mobile_catalog.db uploaded")

s3.upload_file(
    "catalog_images.zip",
    R2_BUCKET_NAME,
    "catalog_images.zip",
    ExtraArgs={"ContentType": "application/zip", "CacheControl": "no-cache, no-store, must-revalidate"}
)
print("catalog_images.zip uploaded")
