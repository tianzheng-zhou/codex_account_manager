import re
import httpx
from typing import Optional
from urllib.parse import urlparse

from config import PROXY_URL


def _get_mailbox_base(code_url: str) -> str:
    parsed = urlparse(code_url)
    path = parsed.path.rstrip("/")
    return f"{parsed.scheme}://{parsed.netloc}{path}"


async def fetch_verification_code(
    email: str, password: str, code_url: str
) -> dict:
    base = _get_mailbox_base(code_url)
    login_url = f"{base}/auth/login"
    messages_url = f"{base}/api/messages?limit=10"

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True, proxy=PROXY_URL) as client:
            login_resp = await client.post(
                login_url,
                json={"address": email, "password": password},
            )

            if login_resp.status_code != 200:
                return {"code": None, "error": f"邮箱登录失败 (HTTP {login_resp.status_code})"}

            login_data = login_resp.json()
            if not login_data.get("ok"):
                return {"code": None, "error": "邮箱登录失败：账号或密码错误"}

            msgs_resp = await client.get(messages_url)
            if msgs_resp.status_code != 200:
                return {"code": None, "error": f"获取邮件列表失败 (HTTP {msgs_resp.status_code})"}

            msgs_data = msgs_resp.json()

            items = msgs_data.get("items", [])
            if not items:
                return {"code": None, "error": "邮箱中暂无邮件"}

            latest = items[0]
            subject = latest.get("subject", "")
            received_at = latest.get("receivedAt", "")

            code_match = re.search(r"\b(\d{6})\b", subject)
            code = code_match.group(1) if code_match else None

            return {
                "code": code,
                "subject": subject,
                "received_at": received_at,
                "error": None if code else "未能从邮件主题中提取验证码",
            }

    except httpx.TimeoutException:
        return {"code": None, "error": "连接邮箱服务超时"}
    except Exception as e:
        return {"code": None, "error": f"接码失败: {str(e)}"}
