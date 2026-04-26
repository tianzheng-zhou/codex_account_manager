import secrets
from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_, select
from typing import Optional, List
from datetime import datetime
import os

from sqlalchemy import inspect, text
from database import engine, get_db, Base
from models import Account, User, InviteCode, AccountShare
from schemas import (
    AccountCreate,
    AccountUpdate,
    AccountOut,
    RedeemRequest,
    StatsOut,
    TeamParentCandidate,
    SelfImportRequest,
    SelfImportResponse,
    FetchCodeResponse,
    RegisterRequest,
    LoginRequest,
    TokenResponse,
    UserOut,
    UserBrief,
    InviteCodeOut,
    ChangePasswordRequest,
    ShareRequest,
    TransferRequest,
    ClaimRequest,
)
from scraper import redeem_key
from mailbox import fetch_outlook_verification_code, fetch_verification_code
from auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    require_admin,
    get_effective_role,
    ensure_default_admin,
    sanitize_url,
    check_auth_ip_rate_limit,
    check_login_rate_limit,
    record_login_failure,
    clear_login_failures,
    MIN_PASSWORD_LENGTH,
)

SELF_SHOP = "self"
TEAM_ROLE_PARENT = "parent"
TEAM_ROLE_CHILD = "child"
ACCOUNT_TYPES = {"Team", "Plus"}
ACCOUNT_STATUSES = {"available", "archived"}
PROVIDER_GOOGLE = "google"
PROVIDER_OUTLOOK = "outlook"
LOGIN_METHOD_GOOGLE_OAUTH = "google_oauth"
LOGIN_METHOD_PASSWORD = "password"

Base.metadata.create_all(bind=engine)

with engine.connect() as conn:
    inspector = inspect(engine)
    columns = [c["name"] for c in inspector.get_columns("accounts")]
    if "shop" not in columns:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN shop TEXT NOT NULL DEFAULT 'gpt-cw'"))
        conn.commit()
    if "created_by" not in columns:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL"))
        conn.commit()
    if "team_role" not in columns:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN team_role TEXT"))
        conn.commit()
    if "team_parent_id" not in columns:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN team_parent_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL"))
        conn.commit()
    if "recovery_email" not in columns:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN recovery_email TEXT"))
        conn.commit()
    if "mail_auth_code" not in columns:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN mail_auth_code TEXT"))
        conn.commit()
    if "mail_token" not in columns:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN mail_token TEXT"))
        conn.commit()
    if "account_provider" not in columns:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN account_provider TEXT"))
        conn.commit()
    if "login_method" not in columns:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN login_method TEXT"))
        conn.commit()

ensure_default_admin()

app = FastAPI(title="Codex 账号管理系统")

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
DESIGN_SYSTEM_DIR = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "Claude-Inspired Design System"
)

app.mount("/design-system", StaticFiles(directory=DESIGN_SYSTEM_DIR), name="design-system")
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
async def serve_index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


# ===== Helpers =====

def _client_ip(request: Request) -> str:
    xf = request.headers.get("X-Forwarded-For")
    if xf:
        return xf.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _user_can_view_account(account: Account, user: User, effective_role: str, db: Session) -> bool:
    if effective_role == "admin":
        return True
    if account.created_by == user.id:
        return True
    share = db.query(AccountShare).filter(
        AccountShare.account_id == account.id,
        AccountShare.user_id == user.id,
    ).first()
    return share is not None


def _user_can_edit_account(account: Account, user: User, effective_role: str) -> bool:
    if effective_role == "admin":
        return True
    return account.created_by == user.id


def _strip_or_none(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _account_label(account: Account) -> str:
    return account.email or account.redeem_key


def _generate_self_redeem_key(db: Session) -> str:
    for _ in range(20):
        key = f"SELF-{secrets.token_hex(6).upper()}"
        exists = db.query(Account).filter(Account.redeem_key == key).first()
        if not exists:
            return key
    raise HTTPException(status_code=500, detail="无法生成唯一账号标识，请重试")


def _ensure_unique_redeem_key(db: Session, redeem_key: str, account_id: Optional[int] = None):
    q = db.query(Account).filter(Account.redeem_key == redeem_key)
    if account_id is not None:
        q = q.filter(Account.id != account_id)
    if q.first():
        raise HTTPException(status_code=400, detail="该账号标识已存在")


def _self_email_exists(db: Session, email: str) -> bool:
    return (
        db.query(Account.id)
        .filter(Account.shop == SELF_SHOP, Account.email.ilike(email))
        .first()
        is not None
    )


def _account_has_children(account_id: int, db: Session) -> bool:
    return db.query(Account.id).filter(Account.team_parent_id == account_id).first() is not None


def _validate_team_parent_id(
    parent_id: Optional[int],
    db: Session,
    current_user: User,
    effective_role: str,
    account_id: Optional[int] = None,
    require_edit_permission: bool = True,
) -> Optional[int]:
    if parent_id in (None, ""):
        return None
    try:
        parent_id = int(parent_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="所属母号无效")
    if account_id is not None and parent_id == account_id:
        raise HTTPException(status_code=400, detail="子号不能绑定到自己")

    parent = db.query(Account).filter(Account.id == parent_id).first()
    if (
        not parent
        or parent.shop != SELF_SHOP
        or parent.account_type != "Team"
        or parent.team_role != TEAM_ROLE_PARENT
    ):
        raise HTTPException(status_code=400, detail="所属母号不存在或不是自有 Team 母号")
    if require_edit_permission and not _user_can_edit_account(parent, current_user, effective_role):
        raise HTTPException(status_code=403, detail="只能绑定到自己可编辑的母号")
    return parent_id


def _normalize_account_payload(
    payload: dict,
    db: Session,
    current_user: User,
    effective_role: str,
    account: Optional[Account] = None,
) -> dict:
    for key in (
        "redeem_key",
        "shop",
        "account_type",
        "status",
        "team_role",
        "email",
        "password",
        "recovery_email",
        "mail_auth_code",
        "mail_token",
        "account_provider",
        "login_method",
    ):
        if key in payload and isinstance(payload[key], str):
            payload[key] = payload[key].strip()
    for key in ("recovery_email", "mail_auth_code", "mail_token", "account_provider", "login_method"):
        if key in payload:
            payload[key] = _strip_or_none(payload[key])

    final_shop = payload.get("shop", account.shop if account else "gpt-cw") or "gpt-cw"
    final_account_type = payload.get("account_type", account.account_type if account else "Team") or "Team"
    final_status = payload.get("status", account.status if account else "available") or "available"

    if final_account_type not in ACCOUNT_TYPES:
        raise HTTPException(status_code=400, detail="账号类型无效")
    if final_status not in ACCOUNT_STATUSES:
        raise HTTPException(status_code=400, detail="账号状态无效")

    if account is None:
        redeem_key = _strip_or_none(payload.get("redeem_key"))
        if final_shop == SELF_SHOP and not redeem_key:
            redeem_key = _generate_self_redeem_key(db)
        elif not redeem_key:
            raise HTTPException(status_code=400, detail="店铺账号必须填写兑换密钥")
        _ensure_unique_redeem_key(db, redeem_key)
        payload["redeem_key"] = redeem_key

    if final_shop != SELF_SHOP or final_account_type != "Team":
        if account is not None and _account_has_children(account.id, db):
            raise HTTPException(status_code=400, detail="该母号仍有绑定子号，请先解除或迁移子号绑定")
        payload["team_role"] = None
        payload["team_parent_id"] = None
        return payload

    final_team_role = _strip_or_none(
        payload.get("team_role", account.team_role if account else TEAM_ROLE_PARENT)
    ) or TEAM_ROLE_PARENT
    if final_team_role not in {TEAM_ROLE_PARENT, TEAM_ROLE_CHILD}:
        raise HTTPException(status_code=400, detail="Team 角色无效")

    if account is not None and _account_has_children(account.id, db) and final_team_role != TEAM_ROLE_PARENT:
        raise HTTPException(status_code=400, detail="该母号仍有绑定子号，请先解除或迁移子号绑定")

    payload["team_role"] = final_team_role
    if final_team_role == TEAM_ROLE_PARENT:
        payload["team_parent_id"] = None
    else:
        parent_id = payload.get("team_parent_id", account.team_parent_id if account else None)
        parent_id_changed = True
        if account is not None:
            try:
                parent_id_changed = (
                    None if parent_id in (None, "") else int(parent_id)
                ) != account.team_parent_id
            except (TypeError, ValueError):
                parent_id_changed = True
        payload["team_parent_id"] = _validate_team_parent_id(
            parent_id,
            db,
            current_user,
            effective_role,
            account.id if account else None,
            require_edit_permission=(account is None or parent_id_changed),
        )

    return payload


def _serialize_account(account: Account, user: User, effective_role: str, db: Session) -> dict:
    owner_username = None
    if account.created_by is not None:
        owner = db.query(User).filter(User.id == account.created_by).first()
        if owner:
            owner_username = owner.username

    team_parent_label = None
    if account.team_parent_id:
        parent = db.query(Account).filter(Account.id == account.team_parent_id).first()
        if parent:
            team_parent_label = _account_label(parent)

    shares_q = (
        db.query(AccountShare, User)
        .join(User, AccountShare.user_id == User.id)
        .filter(AccountShare.account_id == account.id)
        .all()
    )
    shared_with = [{"id": u.id, "username": u.username} for _s, u in shares_q]

    if account.created_by is None:
        relation = "orphan" if effective_role == "admin" else "shared"
    elif account.created_by == user.id:
        relation = "owner"
    elif any(s[1].id == user.id for s in shares_q):
        relation = "shared"
    else:
        relation = "admin"

    return {
        "id": account.id,
        "redeem_key": account.redeem_key,
        "shop": account.shop,
        "account_type": account.account_type,
        "email": account.email,
        "password": account.password,
        "recovery_email": account.recovery_email,
        "mail_auth_code": account.mail_auth_code,
        "mail_token": account.mail_token,
        "account_provider": account.account_provider,
        "login_method": account.login_method,
        "code_url": account.code_url,
        "status": account.status,
        "remark": account.remark,
        "redeemed_at": account.redeemed_at,
        "team_role": account.team_role,
        "team_parent_id": account.team_parent_id,
        "team_parent_label": team_parent_label,
        "created_by": account.created_by,
        "owner_username": owner_username,
        "shared_with": shared_with,
        "relation": relation,
        "created_at": account.created_at,
        "updated_at": account.updated_at,
    }


def _filter_visible_accounts_query(q, user: User, effective_role: str):
    if effective_role == "admin":
        return q
    shared_sel = select(AccountShare.account_id).where(AccountShare.user_id == user.id)
    return q.filter(or_(Account.created_by == user.id, Account.id.in_(shared_sel)))


# ===== Auth Routes =====

@app.post("/api/auth/register", response_model=UserOut)
def register(data: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    check_auth_ip_rate_limit(_client_ip(request))

    username = data.username.strip()
    invite_code = data.invite_code.strip() if data.invite_code else None

    if len(username) < 2:
        raise HTTPException(status_code=400, detail="用户名至少 2 个字符")
    if len(data.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"密码至少 {MIN_PASSWORD_LENGTH} 个字符")

    existing = db.query(User).filter(User.username == username).first()
    if existing:
        raise HTTPException(status_code=400, detail="注册失败，请更换用户名或稍后重试")

    is_approved = False
    if invite_code:
        invite = db.query(InviteCode).filter(
            InviteCode.code == invite_code, InviteCode.used_by.is_(None)
        ).first()
        if not invite:
            raise HTTPException(status_code=400, detail="邀请码无效或已被使用")
        is_approved = True

    user = User(
        username=username,
        password_hash=hash_password(data.password),
        role="user",
        is_approved=is_approved,
    )
    db.add(user)
    db.flush()

    if invite_code:
        invite.used_by = user.id
        invite.used_at = datetime.now()

    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@app.post("/api/auth/login", response_model=TokenResponse)
def login(data: LoginRequest, request: Request, db: Session = Depends(get_db)):
    username = data.username.strip()
    ip = _client_ip(request)
    check_auth_ip_rate_limit(ip)
    check_login_rate_limit(username, ip)

    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(data.password, user.password_hash):
        record_login_failure(username, ip)
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if not user.is_approved:
        raise HTTPException(status_code=403, detail="账号待审核，请联系管理员")

    clear_login_failures(username, ip)
    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(access_token=token)


@app.get("/api/auth/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return UserOut.model_validate(current_user)


@app.put("/api/auth/password")
def change_password(
    data: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(data.old_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="当前密码不正确")
    if len(data.new_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"新密码至少 {MIN_PASSWORD_LENGTH} 个字符")
    if data.old_password == data.new_password:
        raise HTTPException(status_code=400, detail="新密码不能与当前密码相同")
    current_user.password_hash = hash_password(data.new_password)
    db.commit()
    return {"ok": True}


# ===== User lookup =====

@app.get("/api/users/lookup", response_model=UserBrief)
def lookup_user(
    username: str = Query(..., min_length=1, max_length=64),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Exact-match username lookup (for sharing/transfer). Never returns list."""
    user = db.query(User).filter(User.username == username, User.is_approved.is_(True)).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return UserBrief.model_validate(user)


@app.get("/api/users/search", response_model=List[UserBrief])
def search_users(
    q: Optional[str] = Query(None, max_length=64),
    limit: int = Query(20, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    effective_role: str = Depends(get_effective_role),
):
    """Suggest users for sharing/transfer/claim pickers.

    - Admin (effective): `q` can be empty (lists all approved users, alphabetical).
    - Non-admin: `q` must be at least 2 characters (prevents trivial enumeration).
    Only approved users are returned. The caller is always excluded.
    """
    q_text = (q or "").strip()
    base = db.query(User).filter(
        User.is_approved.is_(True), User.id != current_user.id
    )

    if effective_role == "admin":
        if q_text:
            base = base.filter(User.username.ilike(f"%{q_text}%"))
    else:
        if len(q_text) < 2:
            return []
        base = base.filter(User.username.ilike(f"%{q_text}%"))

    rows = base.order_by(User.username.asc()).limit(limit).all()
    return [UserBrief.model_validate(u) for u in rows]


# ===== Admin Routes =====

@app.get("/api/admin/users", response_model=List[UserOut])
def admin_list_users(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    users = db.query(User).order_by(User.id.asc()).all()
    return [UserOut.model_validate(u) for u in users]


@app.put("/api/admin/users/{user_id}/approve", response_model=UserOut)
def admin_approve_user(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    user.is_approved = True
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="不能删除自己")
    db.delete(user)
    db.commit()
    return {"ok": True}


@app.post("/api/admin/invite-codes", response_model=InviteCodeOut)
def admin_create_invite_code(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    code = secrets.token_urlsafe(8).upper()
    invite = InviteCode(code=code, created_by=admin.id)
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return InviteCodeOut.model_validate(invite)


@app.get("/api/admin/invite-codes", response_model=List[InviteCodeOut])
def admin_list_invite_codes(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    codes = db.query(InviteCode).order_by(InviteCode.id.desc()).all()
    return [InviteCodeOut.model_validate(c) for c in codes]


@app.delete("/api/admin/invite-codes/{code_id}")
def admin_delete_invite_code(
    code_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    invite = db.query(InviteCode).filter(InviteCode.id == code_id).first()
    if not invite:
        raise HTTPException(status_code=404, detail="邀请码不存在")
    db.delete(invite)
    db.commit()
    return {"ok": True}


# ===== Account Routes (protected) =====

@app.get("/api/accounts")
def list_accounts(
    search: Optional[str] = Query(None),
    account_type: Optional[str] = Query(None),
    team_role_filter: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    shop: Optional[str] = Query(None),
    scope: Optional[str] = Query(None),  # "mine" | "shared" | None(all visible)
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    effective_role: str = Depends(get_effective_role),
):
    q = db.query(Account)
    q = _filter_visible_accounts_query(q, current_user, effective_role)

    if shop:
        q = q.filter(Account.shop == shop)
    if search:
        pattern = f"%{search}%"
        q = q.filter(
            (Account.email.ilike(pattern))
            | (Account.recovery_email.ilike(pattern))
            | (Account.redeem_key.ilike(pattern))
            | (Account.remark.ilike(pattern))
        )
    if account_type:
        q = q.filter(Account.account_type == account_type)
    if team_role_filter:
        if team_role_filter == "plus":
            q = q.filter(Account.account_type == "Plus")
        elif team_role_filter == TEAM_ROLE_PARENT:
            q = q.filter(Account.account_type == "Team", Account.team_role == TEAM_ROLE_PARENT)
        elif team_role_filter == TEAM_ROLE_CHILD:
            q = q.filter(Account.account_type == "Team", Account.team_role == TEAM_ROLE_CHILD)
        elif team_role_filter == "child_unbound":
            q = q.filter(
                Account.account_type == "Team",
                Account.team_role == TEAM_ROLE_CHILD,
                Account.team_parent_id.is_(None),
            )
    if status:
        q = q.filter(Account.status == status)

    if scope == "mine":
        q = q.filter(Account.created_by == current_user.id)
    elif scope == "shared":
        shared_sel = select(AccountShare.account_id).where(AccountShare.user_id == current_user.id)
        q = q.filter(Account.id.in_(shared_sel))
    elif scope == "orphan" and effective_role == "admin":
        q = q.filter(Account.created_by.is_(None))

    accounts = q.order_by(Account.id.desc()).all()
    return [_serialize_account(a, current_user, effective_role, db) for a in accounts]


@app.get("/api/accounts/team-parents", response_model=List[TeamParentCandidate])
def list_team_parent_candidates(
    exclude_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    effective_role: str = Depends(get_effective_role),
):
    q = db.query(Account).filter(
        Account.shop == SELF_SHOP,
        Account.account_type == "Team",
        Account.team_role == TEAM_ROLE_PARENT,
    )
    if exclude_id is not None:
        q = q.filter(Account.id != exclude_id)
    if effective_role != "admin":
        q = q.filter(Account.created_by == current_user.id)

    rows = q.order_by(Account.email.asc()).all()
    result = []
    for account in rows:
        owner_username = None
        if account.created_by is not None:
            owner = db.query(User).filter(User.id == account.created_by).first()
            owner_username = owner.username if owner else None
        result.append(
            TeamParentCandidate(
                id=account.id,
                email=account.email,
                redeem_key=account.redeem_key,
                owner_username=owner_username,
                remark=account.remark,
            )
        )
    return result


def _parse_self_import_line(raw: str) -> dict:
    parts = [p.strip() for p in raw.split("----")]
    if len(parts) == 3:
        email, password, recovery_email = parts
        if not email or not password or not recovery_email:
            raise ValueError("Google 格式的邮箱、密码、辅助邮箱都不能为空")
        if "@" not in email:
            raise ValueError("邮箱格式不正确")
        if "@" not in recovery_email:
            raise ValueError("辅助邮箱格式不正确")
        return {
            "email": email,
            "password": password,
            "recovery_email": recovery_email,
            "mail_auth_code": None,
            "mail_token": None,
            "account_provider": PROVIDER_GOOGLE,
            "login_method": LOGIN_METHOD_GOOGLE_OAUTH,
        }
    if len(parts) == 4:
        email, password, mail_auth_code, mail_token = parts
        if not email or not password or not mail_auth_code or not mail_token:
            raise ValueError("Outlook 格式的邮箱、密码、授权码、令牌都不能为空")
        if "@" not in email:
            raise ValueError("邮箱格式不正确")
        return {
            "email": email,
            "password": password,
            "recovery_email": None,
            "mail_auth_code": mail_auth_code,
            "mail_token": mail_token,
            "account_provider": PROVIDER_OUTLOOK,
            "login_method": LOGIN_METHOD_PASSWORD,
        }
    raise ValueError("格式应为：Google 邮箱----密码----辅助邮箱，或 Outlook 邮箱----密码----授权码----令牌")


@app.post("/api/accounts/import-self", response_model=SelfImportResponse)
def import_self_accounts(
    data: SelfImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    effective_role: str = Depends(get_effective_role),
):
    accounts = []
    errors = []
    seen_emails = set()

    for line_no, raw_line in enumerate(data.raw_text.splitlines(), start=1):
        raw = raw_line.strip()
        if not raw:
            continue

        try:
            parsed = _parse_self_import_line(raw)
            email = parsed["email"]
            email_key = email.lower()
            if email_key in seen_emails:
                raise ValueError("本次导入中邮箱重复")
            seen_emails.add(email_key)
            if _self_email_exists(db, email):
                raise ValueError("该自有账号邮箱已存在")

            payload = {
                "redeem_key": None,
                "shop": SELF_SHOP,
                "account_type": data.account_type,
                "team_role": data.team_role,
                "team_parent_id": data.team_parent_id,
                "code_url": None,
                "status": "available",
                "remark": "",
                **parsed,
            }
            payload = _normalize_account_payload(payload, db, current_user, effective_role)

            account = Account(**payload, created_by=current_user.id)
            db.add(account)
            db.commit()
            db.refresh(account)
            accounts.append(_serialize_account(account, current_user, effective_role, db))
        except HTTPException as exc:
            db.rollback()
            errors.append({"line": line_no, "raw": raw, "error": str(exc.detail)})
        except ValueError as exc:
            db.rollback()
            errors.append({"line": line_no, "raw": raw, "error": str(exc)})

    return SelfImportResponse(
        created=len(accounts),
        failed=len(errors),
        accounts=accounts,
        errors=errors,
    )


@app.post("/api/accounts", response_model=AccountOut)
def create_account(
    data: AccountCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    effective_role: str = Depends(get_effective_role),
):
    payload = data.model_dump()
    payload = _normalize_account_payload(payload, db, current_user, effective_role)
    payload["code_url"] = sanitize_url(payload.get("code_url"))
    account = Account(**payload, created_by=current_user.id)
    db.add(account)
    db.commit()
    db.refresh(account)
    return _serialize_account(account, current_user, effective_role, db)


@app.post("/api/accounts/redeem", response_model=AccountOut)
async def redeem_account(
    req: RedeemRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    effective_role: str = Depends(get_effective_role),
):
    existing = db.query(Account).filter(Account.redeem_key == req.key).first()
    if existing:
        raise HTTPException(status_code=400, detail="该兑换密钥已录入系统")

    result = await redeem_key(req.key)
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result.get("error", "兑换失败"))

    info = result["data"]
    key_upper = req.key.upper()
    if "account_type" not in info:
        if key_upper.startswith("PLUS"):
            info["account_type"] = "Plus"
        elif key_upper.startswith("TEAM"):
            info["account_type"] = "Team"
        else:
            info["account_type"] = "Team"

    account = Account(
        redeem_key=req.key,
        shop=req.shop,
        account_type=info["account_type"],
        email=info["email"],
        password=info["password"],
        code_url=sanitize_url(info.get("code_url")),
        redeemed_at=info.get("redeemed_at") or datetime.now().strftime("%Y-%m-%d %H:%M"),
        status="available",
        created_by=current_user.id,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return _serialize_account(account, current_user, effective_role, db)


@app.put("/api/accounts/{account_id}", response_model=AccountOut)
def update_account(
    account_id: int,
    data: AccountUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    effective_role: str = Depends(get_effective_role),
):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")
    if not _user_can_view_account(account, current_user, effective_role, db):
        raise HTTPException(status_code=404, detail="账号不存在")
    if not _user_can_edit_account(account, current_user, effective_role):
        raise HTTPException(status_code=403, detail="仅拥有者或管理员可编辑该账号")

    update_data = data.model_dump(exclude_unset=True)
    update_data = _normalize_account_payload(update_data, db, current_user, effective_role, account)
    if "code_url" in update_data:
        update_data["code_url"] = sanitize_url(update_data["code_url"])
    for k, v in update_data.items():
        setattr(account, k, v)

    db.commit()
    db.refresh(account)
    return _serialize_account(account, current_user, effective_role, db)


@app.delete("/api/accounts/{account_id}")
def delete_account(
    account_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")
    db.query(Account).filter(Account.team_parent_id == account_id).update(
        {Account.team_parent_id: None}, synchronize_session=False
    )
    db.delete(account)
    db.commit()
    return {"ok": True}


@app.get("/api/stats", response_model=StatsOut)
def get_stats(
    shop: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    effective_role: str = Depends(get_effective_role),
):
    q = db.query(Account)
    q = _filter_visible_accounts_query(q, current_user, effective_role)
    if shop:
        q = q.filter(Account.shop == shop)
    all_accounts = q.all()
    return StatsOut(
        total=len(all_accounts),
        team=sum(1 for a in all_accounts if a.account_type == "Team"),
        plus=sum(1 for a in all_accounts if a.account_type == "Plus"),
        available=sum(1 for a in all_accounts if a.status == "available"),
        archived=sum(1 for a in all_accounts if a.status == "archived"),
        shop=shop,
    )


@app.post("/api/accounts/{account_id}/fetch-code", response_model=FetchCodeResponse)
async def fetch_code(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    effective_role: str = Depends(get_effective_role),
):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")
    if not _user_can_view_account(account, current_user, effective_role, db):
        raise HTTPException(status_code=404, detail="账号不存在")
    if account.code_url:
        result = await fetch_verification_code(
            account.email, account.password, account.code_url
        )
        return FetchCodeResponse(**result)

    is_outlook = account.account_provider == PROVIDER_OUTLOOK or (
        bool(account.mail_auth_code) and bool(account.mail_token)
    )
    if not is_outlook:
        raise HTTPException(status_code=400, detail="该账号没有可用收码方式")
    if not account.mail_auth_code or not account.mail_token:
        raise HTTPException(status_code=400, detail="Outlook 账号缺少授权码或令牌")

    result = await fetch_outlook_verification_code(
        account.email,
        account.mail_auth_code,
        account.mail_token,
    )
    new_refresh_token = result.pop("new_refresh_token", None)
    if new_refresh_token and new_refresh_token != account.mail_token:
        account.mail_token = new_refresh_token
        db.commit()
    return FetchCodeResponse(**result)


# ===== Sharing / Transfer / Claim =====

@app.get("/api/accounts/{account_id}/shares", response_model=List[UserBrief])
def list_shares(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    effective_role: str = Depends(get_effective_role),
):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")
    if not _user_can_view_account(account, current_user, effective_role, db):
        raise HTTPException(status_code=404, detail="账号不存在")

    rows = (
        db.query(User)
        .join(AccountShare, AccountShare.user_id == User.id)
        .filter(AccountShare.account_id == account_id)
        .all()
    )
    return [UserBrief.model_validate(u) for u in rows]


@app.post("/api/accounts/{account_id}/shares", response_model=UserBrief)
def add_share(
    account_id: int,
    data: ShareRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    effective_role: str = Depends(get_effective_role),
):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")
    if not _user_can_edit_account(account, current_user, effective_role):
        raise HTTPException(status_code=403, detail="仅拥有者或管理员可管理共享")

    target = db.query(User).filter(
        User.username == data.username, User.is_approved.is_(True)
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    if account.created_by == target.id:
        raise HTTPException(status_code=400, detail="该用户已是拥有者")

    existing = db.query(AccountShare).filter(
        AccountShare.account_id == account_id, AccountShare.user_id == target.id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="该账号已共享给此用户")

    share = AccountShare(account_id=account_id, user_id=target.id)
    db.add(share)
    db.commit()
    return UserBrief.model_validate(target)


@app.delete("/api/accounts/{account_id}/shares/{user_id}")
def remove_share(
    account_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    effective_role: str = Depends(get_effective_role),
):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")
    if not _user_can_edit_account(account, current_user, effective_role):
        raise HTTPException(status_code=403, detail="仅拥有者或管理员可管理共享")

    share = db.query(AccountShare).filter(
        AccountShare.account_id == account_id, AccountShare.user_id == user_id
    ).first()
    if not share:
        raise HTTPException(status_code=404, detail="共享记录不存在")
    db.delete(share)
    db.commit()
    return {"ok": True}


@app.put("/api/accounts/{account_id}/transfer", response_model=AccountOut)
def transfer_account(
    account_id: int,
    data: TransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    effective_role: str = Depends(get_effective_role),
):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")
    if not _user_can_edit_account(account, current_user, effective_role):
        raise HTTPException(status_code=403, detail="仅拥有者或管理员可转让")

    target = db.query(User).filter(
        User.username == data.username, User.is_approved.is_(True)
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    if account.created_by == target.id:
        raise HTTPException(status_code=400, detail="该用户已是拥有者")

    account.created_by = target.id
    # Remove any existing share to the new owner (redundant).
    db.query(AccountShare).filter(
        AccountShare.account_id == account_id, AccountShare.user_id == target.id
    ).delete()
    db.commit()
    db.refresh(account)
    return _serialize_account(account, current_user, effective_role, db)


@app.put("/api/accounts/{account_id}/claim", response_model=AccountOut)
def claim_account(
    account_id: int,
    data: ClaimRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Admin-only: assign an orphan account (created_by is NULL) to a user."""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")
    if account.created_by is not None:
        raise HTTPException(status_code=400, detail="该账号已有拥有者，请改用转让")

    target = db.query(User).filter(
        User.username == data.username, User.is_approved.is_(True)
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")

    account.created_by = target.id
    db.commit()
    db.refresh(account)
    return _serialize_account(account, admin, "admin", db)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=25487,
        reload=os.environ.get("CODEX_RELOAD") == "1",
    )
