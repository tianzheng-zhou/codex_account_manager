import re
import httpx
from typing import Optional
from urllib.parse import urlparse
from bs4 import BeautifulSoup

from config import PROXY_URL


def _get_mailbox_base(code_url: str) -> str:
    parsed = urlparse(code_url)
    path = parsed.path.rstrip("/")
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def _extract_code_from_html(html: str) -> Optional[str]:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.find_all(["style", "script"]):
        tag.decompose()
    text = soup.get_text(separator=" ")
    match = re.search(r"(?<!\#)(?<!\w)(\d{6})(?!\w)", text)
    return match.group(1) if match else None


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
            msg_id = latest.get("id", "")

            code_match = re.search(r"\b(\d{6})\b", subject)
            code = code_match.group(1) if code_match else None

            if not code and msg_id:
                detail_url = f"{base}/api/messages/{msg_id}"
                detail_resp = await client.get(detail_url)
                if detail_resp.status_code == 200:
                    detail = detail_resp.json()
                    item = detail.get("item", detail)
                    html_body = item.get("htmlBody", "") or ""
                    text_body = item.get("textBody", "") or ""

                    if html_body:
                        code = _extract_code_from_html(html_body)
                    if not code and text_body:
                        m = re.search(r"(?<!\#)(?<!\w)(\d{6})(?!\w)", text_body)
                        code = m.group(1) if m else None

            return {
                "code": code,
                "subject": subject,
                "received_at": received_at,
                "error": None if code else f"未能提取验证码（主题：{subject}）",
            }

    except httpx.TimeoutException:
        return {"code": None, "error": "连接邮箱服务超时"}
    except Exception as e:
        return {"code": None, "error": f"接码失败: {str(e)}"}
