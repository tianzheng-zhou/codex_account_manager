import asyncio
import base64
import imaplib
import poplib
import re
from email import message_from_bytes
from email.header import decode_header
from email.utils import parsedate_to_datetime
import httpx
from typing import Optional
from urllib.parse import urlparse
from bs4 import BeautifulSoup

from config import PROXY_URL

OUTLOOK_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
OUTLOOK_IMAP_HOST = "imap-mail.outlook.com"
OUTLOOK_IMAP_HOSTS = (OUTLOOK_IMAP_HOST, "outlook.office365.com")
OUTLOOK_IMAP_PORT = 993
OUTLOOK_IMAP_SCOPE = "https://outlook.office.com/IMAP.AccessAsUser.All offline_access"
OUTLOOK_POP_HOST = "pop-mail.outlook.com"
OUTLOOK_POP_HOSTS = (OUTLOOK_POP_HOST, "outlook.office365.com")
OUTLOOK_POP_PORT = 995
OUTLOOK_POP_SCOPE = "https://outlook.office.com/POP.AccessAsUser.All offline_access"
OUTLOOK_GRAPH_SCOPE = "https://graph.microsoft.com/Mail.Read offline_access"
OUTLOOK_GRAPH_MESSAGES_URL = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages"
OUTLOOK_IMAP_FOLDERS = ("INBOX", "Inbox", "Junk", "Junk Email")


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


def _extract_code_from_text(text: str) -> Optional[str]:
    match = re.search(r"(?<!\#)(?<!\w)(\d{6})(?!\w)", text or "")
    return match.group(1) if match else None


def _decode_mime_header(value: Optional[str]) -> str:
    if not value:
        return ""
    decoded = []
    for part, encoding in decode_header(value):
        if isinstance(part, bytes):
            decoded.append(part.decode(encoding or "utf-8", errors="replace"))
        else:
            decoded.append(part)
    return "".join(decoded)


def _decode_payload(part) -> str:
    payload = part.get_payload(decode=True)
    if payload is None:
        raw_payload = part.get_payload()
        return raw_payload if isinstance(raw_payload, str) else ""
    charset = part.get_content_charset() or "utf-8"
    return payload.decode(charset, errors="replace")


def _message_text(message) -> tuple[str, str]:
    text_parts = []
    html_parts = []
    if message.is_multipart():
        for part in message.walk():
            content_type = part.get_content_type()
            disposition = (part.get("Content-Disposition") or "").lower()
            if "attachment" in disposition:
                continue
            if content_type == "text/plain":
                text_parts.append(_decode_payload(part))
            elif content_type == "text/html":
                html_parts.append(_decode_payload(part))
    else:
        content_type = message.get_content_type()
        if content_type == "text/html":
            html_parts.append(_decode_payload(message))
        else:
            text_parts.append(_decode_payload(message))
    return "\n".join(text_parts), "\n".join(html_parts)


def _message_received_at(message) -> str:
    raw_date = message.get("Date") or ""
    if not raw_date:
        return ""
    try:
        return parsedate_to_datetime(raw_date).isoformat()
    except Exception:
        return raw_date


async def _refresh_outlook_access_token(
    client_id: str,
    refresh_token: str,
    scope: str = OUTLOOK_IMAP_SCOPE,
) -> dict:
    try:
        async with httpx.AsyncClient(timeout=30, proxy=PROXY_URL) as client:
            resp = await client.post(
                OUTLOOK_TOKEN_URL,
                data={
                    "client_id": client_id,
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "scope": scope,
                },
            )
        try:
            data = resp.json()
        except ValueError:
            data = {}

        if resp.status_code != 200:
            error = data.get("error_description") or data.get("error") or resp.text
            return {"access_token": None, "error": f"Microsoft token 刷新失败 (HTTP {resp.status_code}): {error}"}

        access_token = data.get("access_token")
        if not access_token:
            return {"access_token": None, "error": "Microsoft token 响应缺少 access_token"}

        return {
            "access_token": access_token,
            "new_refresh_token": data.get("refresh_token"),
            "error": None,
        }
    except httpx.TimeoutException:
        return {"access_token": None, "error": "Microsoft token 刷新超时"}
    except Exception as e:
        return {"access_token": None, "error": f"Microsoft token 刷新失败: {str(e)}"}


def _xoauth2_string(email_address: str, access_token: str) -> str:
    return f"user={email_address}\x01auth=Bearer {access_token}\x01\x01"


def _xoauth2_b64(email_address: str, access_token: str) -> str:
    return base64.b64encode(_xoauth2_string(email_address, access_token).encode("utf-8")).decode("ascii")


def _extract_code_from_message_bytes(raw_message: bytes) -> dict:
    message = message_from_bytes(raw_message)
    subject = _decode_mime_header(message.get("Subject"))
    received_at = _message_received_at(message)

    code = _extract_code_from_text(subject)
    if not code:
        text_body, html_body = _message_text(message)
        code = _extract_code_from_text(text_body)
        if not code and html_body:
            code = _extract_code_from_html(html_body)

    return {
        "code": code,
        "subject": subject,
        "received_at": received_at,
        "error": None if code else None,
    }


def _fetch_outlook_code_via_imap_host(email_address: str, access_token: str, host: str) -> dict:
    imap = None
    try:
        imap = imaplib.IMAP4_SSL(host, OUTLOOK_IMAP_PORT)
        auth_string = _xoauth2_string(email_address, access_token)
        imap.authenticate("XOAUTH2", lambda _challenge: auth_string.encode("utf-8"))

        latest_subject = ""
        saw_any_message = False
        opened_any_folder = False
        folder_errors = []

        for folder in OUTLOOK_IMAP_FOLDERS:
            status, data = imap.select(folder, readonly=True)
            if status != "OK":
                folder_errors.append(f"{folder}: 打开失败")
                continue
            opened_any_folder = True

            status, data = imap.search(None, "ALL")
            if status != "OK" or data is None:
                folder_errors.append(f"{folder}: 搜索失败")
                continue
            if not data or not data[0]:
                continue

            message_ids = data[0].split()
            if not message_ids:
                continue
            saw_any_message = True

            for message_id in reversed(message_ids[-10:]):
                status, message_data = imap.fetch(message_id, "(RFC822)")
                if status != "OK" or not message_data:
                    continue

                raw_message = None
                for item in message_data:
                    if isinstance(item, tuple) and item[1]:
                        raw_message = item[1]
                        break
                if not raw_message:
                    continue

                result = _extract_code_from_message_bytes(raw_message)
                latest_subject = latest_subject or result["subject"]

                if result["code"]:
                    return result

        if not opened_any_folder:
            return {
                "code": None,
                "error": f"Outlook IMAP 打开收件箱失败（{'；'.join(folder_errors) or '无可用文件夹'}）",
            }
        if not saw_any_message:
            return {"code": None, "error": "Outlook IMAP 收件箱/垃圾邮件中暂无邮件"}

        return {
            "code": None,
            "subject": latest_subject,
            "received_at": "",
            "error": f"未能从 IMAP 最近邮件提取 6 位验证码（最新主题：{latest_subject or '无'}）",
        }
    except imaplib.IMAP4.error as e:
        return {"code": None, "error": f"Outlook IMAP 登录或读取失败: {str(e)}"}
    except Exception as e:
        return {"code": None, "error": f"Outlook IMAP 收码失败: {str(e)}"}
    finally:
        if imap is not None:
            try:
                imap.logout()
            except Exception:
                pass


def _fetch_outlook_code_via_imap(email_address: str, access_token: str) -> dict:
    errors = []
    for host in OUTLOOK_IMAP_HOSTS:
        result = _fetch_outlook_code_via_imap_host(email_address, access_token, host)
        if result.get("code"):
            return result

        error = result.get("error") or "未知错误"
        errors.append(f"{host}: {error}")
        if "暂无邮件" in error or "未能从" in error:
            return result

    return {
        "code": None,
        "error": "；".join(errors),
    }


def _fetch_outlook_code_via_pop_host(email_address: str, access_token: str, host: str) -> dict:
    pop = None
    try:
        pop = poplib.POP3_SSL(host, OUTLOOK_POP_PORT, timeout=30)
        pop._shortcmd("AUTH XOAUTH2")
        pop._shortcmd(_xoauth2_b64(email_address, access_token))

        _resp, listings, _octets = pop.list()
        if not listings:
            return {"code": None, "error": "Outlook POP 收件箱暂无邮件"}

        latest_subject = ""
        message_count = len(listings)
        for message_id in range(message_count, max(0, message_count - 10), -1):
            _resp, lines, _octets = pop.retr(message_id)
            raw_message = b"\r\n".join(lines)
            result = _extract_code_from_message_bytes(raw_message)
            latest_subject = latest_subject or result["subject"]
            if result["code"]:
                return result

        return {
            "code": None,
            "subject": latest_subject,
            "received_at": "",
            "error": f"未能从 POP 最近邮件提取 6 位验证码（最新主题：{latest_subject or '无'}）",
        }
    except poplib.error_proto as e:
        return {"code": None, "error": f"Outlook POP 登录或读取失败: {str(e)}"}
    except Exception as e:
        return {"code": None, "error": f"Outlook POP 收码失败: {str(e)}"}
    finally:
        if pop is not None:
            try:
                pop.quit()
            except Exception:
                try:
                    pop.close()
                except Exception:
                    pass


def _fetch_outlook_code_via_pop(email_address: str, access_token: str) -> dict:
    errors = []
    for host in OUTLOOK_POP_HOSTS:
        result = _fetch_outlook_code_via_pop_host(email_address, access_token, host)
        if result.get("code"):
            return result

        error = result.get("error") or "未知错误"
        errors.append(f"{host}: {error}")
        if "暂无邮件" in error or "未能从" in error:
            return result

    return {
        "code": None,
        "error": "；".join(errors),
    }


def _should_try_pop_fallback(result: dict) -> bool:
    error = (result.get("error") or "").lower()
    return "authenticated but not connected" in error


def _should_try_graph_fallback(*results: dict) -> bool:
    error = " ".join((result.get("error") or "").lower() for result in results)
    fallback_markers = (
        "userdisabled",
        "authresult=27",
        "authenticated but not connected",
        "pop disabled",
        "imap disabled",
    )
    return any(marker in error for marker in fallback_markers)


async def _fetch_outlook_code_via_graph(access_token: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=30, proxy=PROXY_URL) as client:
            resp = await client.get(
                OUTLOOK_GRAPH_MESSAGES_URL,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Prefer": 'outlook.body-content-type="text"',
                },
                params={
                    "$top": "10",
                    "$orderby": "receivedDateTime desc",
                    "$select": "subject,receivedDateTime,bodyPreview,body",
                },
            )

        try:
            data = resp.json()
        except ValueError:
            data = {}

        if resp.status_code != 200:
            error = data.get("error", {})
            message = error.get("message") if isinstance(error, dict) else None
            return {
                "code": None,
                "error": f"Microsoft Graph 读取邮件失败 (HTTP {resp.status_code}): {message or resp.text}",
            }

        messages = data.get("value") or []
        if not messages:
            return {"code": None, "error": "Microsoft Graph 收件箱暂无邮件"}

        latest_subject = ""
        for message in messages:
            subject = message.get("subject") or ""
            latest_subject = latest_subject or subject
            received_at = message.get("receivedDateTime") or ""
            body_preview = message.get("bodyPreview") or ""
            body = message.get("body") or {}
            body_content = body.get("content") if isinstance(body, dict) else ""

            code = _extract_code_from_text(subject)
            if not code:
                code = _extract_code_from_text(body_preview)
            if not code and body_content:
                code = _extract_code_from_text(body_content)
                if not code:
                    code = _extract_code_from_html(body_content)

            if code:
                return {
                    "code": code,
                    "subject": subject,
                    "received_at": received_at,
                    "error": None,
                }

        return {
            "code": None,
            "subject": latest_subject,
            "received_at": "",
            "error": f"未能从 Graph 最近邮件提取 6 位验证码（最新主题：{latest_subject or '无'}）",
        }
    except httpx.TimeoutException:
        return {"code": None, "error": "Microsoft Graph 读取邮件超时"}
    except Exception as e:
        return {"code": None, "error": f"Microsoft Graph 收码失败: {str(e)}"}


async def fetch_outlook_verification_code(
    email_address: str,
    client_id: str,
    refresh_token: str,
) -> dict:
    imap_token_result = await _refresh_outlook_access_token(client_id, refresh_token, OUTLOOK_IMAP_SCOPE)
    if imap_token_result.get("error"):
        return {"code": None, "error": imap_token_result["error"]}

    latest_refresh_token = imap_token_result.get("new_refresh_token") or refresh_token
    imap_result = await asyncio.to_thread(
        _fetch_outlook_code_via_imap,
        email_address,
        imap_token_result["access_token"],
    )

    if imap_result.get("code") or not _should_try_pop_fallback(imap_result):
        if latest_refresh_token and latest_refresh_token != refresh_token:
            imap_result["new_refresh_token"] = latest_refresh_token
        return imap_result

    pop_token_result = await _refresh_outlook_access_token(client_id, latest_refresh_token, OUTLOOK_POP_SCOPE)
    if pop_token_result.get("error"):
        imap_result["error"] = f"IMAP 返回：{imap_result.get('error')}；POP 兜底 token 刷新失败：{pop_token_result['error']}"
        if latest_refresh_token and latest_refresh_token != refresh_token:
            imap_result["new_refresh_token"] = latest_refresh_token
        return imap_result

    latest_refresh_token = pop_token_result.get("new_refresh_token") or latest_refresh_token
    pop_result = await asyncio.to_thread(
        _fetch_outlook_code_via_pop,
        email_address,
        pop_token_result["access_token"],
    )
    if not pop_result.get("code"):
        pop_result["error"] = f"IMAP 返回：{imap_result.get('error')}；POP 兜底返回：{pop_result.get('error')}"
    if latest_refresh_token and latest_refresh_token != refresh_token:
        pop_result["new_refresh_token"] = latest_refresh_token
    if pop_result.get("code") or not _should_try_graph_fallback(imap_result, pop_result):
        return pop_result

    graph_token_result = await _refresh_outlook_access_token(
        client_id,
        latest_refresh_token,
        OUTLOOK_GRAPH_SCOPE,
    )
    if graph_token_result.get("error"):
        pop_result["error"] = (
            f"{pop_result.get('error')}；Graph 兜底 token 刷新失败：{graph_token_result['error']}。"
            "该 OAuth 令牌可能没有 Mail.Read 授权，或账号关闭了所有远程收信协议。"
        )
        return pop_result

    latest_refresh_token = graph_token_result.get("new_refresh_token") or latest_refresh_token
    graph_result = await _fetch_outlook_code_via_graph(graph_token_result["access_token"])
    if not graph_result.get("code"):
        graph_result["error"] = (
            f"IMAP 返回：{imap_result.get('error')}；POP 兜底返回：{pop_result.get('error')}；"
            f"Graph 兜底返回：{graph_result.get('error')}"
        )
    if latest_refresh_token and latest_refresh_token != refresh_token:
        graph_result["new_refresh_token"] = latest_refresh_token
    return graph_result


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

            code = _extract_code_from_text(subject)

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
                        code = _extract_code_from_text(text_body)

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
