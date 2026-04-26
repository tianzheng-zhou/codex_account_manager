import os

PROXY_URL = (
    os.environ.get("HTTP_PROXY")
    or os.environ.get("http_proxy")
    or os.environ.get("HTTPS_PROXY")
    or os.environ.get("https_proxy")
    or "http://127.0.0.1:7897"
) or None
