import httpx
from bs4 import BeautifulSoup
from typing import Optional


REDEEM_URL = "https://chongzhi.art/claim/redeem"
LOOKUP_URL = "https://chongzhi.art/claim/lookup"

FIELD_MAP = {
    "邮箱": "email",
    "密码": "password",
    "收码": "code_url",
    "档位": "account_type",
    "兑换时间": "redeemed_at",
}


def _parse_account_html(html: str) -> Optional[dict]:
    soup = BeautifulSoup(html, "html.parser")

    err_title = soup.select_one(".err-title")
    if err_title:
        return None

    rows = soup.select(".kv-row")
    if not rows:
        return None

    data = {}
    for row in rows:
        k_el = row.select_one(".k")
        v_el = row.select_one(".v")
        if not k_el or not v_el:
            continue

        k_text = k_el.get_text(strip=True)
        for cn_key, en_key in FIELD_MAP.items():
            if cn_key in k_text:
                link = v_el.select_one("a")
                if link and link.get("href"):
                    data[en_key] = link["href"]
                else:
                    data[en_key] = v_el.get_text(strip=True)
                break

    if "email" not in data or "password" not in data:
        return None

    return data


async def redeem_key(key: str) -> dict:
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.post(REDEEM_URL, data={"code": key})
        result = _parse_account_html(resp.text)

        if result:
            return {"ok": True, "data": result, "source": "redeem"}

        resp2 = await client.post(LOOKUP_URL, data={"code": key})
        result2 = _parse_account_html(resp2.text)

        if result2:
            return {"ok": True, "data": result2, "source": "lookup"}

        return {"ok": False, "error": "兑换码无效或解析失败"}
