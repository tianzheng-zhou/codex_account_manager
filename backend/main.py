import secrets
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
import os

from sqlalchemy import inspect, text
from database import engine, get_db, Base
from models import Account, User, InviteCode
from schemas import (
    AccountCreate,
    AccountUpdate,
    AccountOut,
    RedeemRequest,
    StatsOut,
    FetchCodeResponse,
    RegisterRequest,
    LoginRequest,
    TokenResponse,
    UserOut,
    InviteCodeOut,
)
from scraper import redeem_key
from mailbox import fetch_verification_code
from auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    require_admin,
    ensure_default_admin,
)

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


# ===== Auth Routes =====

@app.post("/api/auth/register", response_model=UserOut)
def register(data: RegisterRequest, db: Session = Depends(get_db)):
    if len(data.username) < 2:
        raise HTTPException(status_code=400, detail="用户名至少 2 个字符")
    if len(data.password) < 4:
        raise HTTPException(status_code=400, detail="密码至少 4 个字符")

    existing = db.query(User).filter(User.username == data.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="用户名已存在")

    is_approved = False
    if data.invite_code:
        invite = db.query(InviteCode).filter(
            InviteCode.code == data.invite_code, InviteCode.used_by.is_(None)
        ).first()
        if not invite:
            raise HTTPException(status_code=400, detail="邀请码无效或已被使用")
        is_approved = True

    user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        role="user",
        is_approved=is_approved,
    )
    db.add(user)
    db.flush()

    if data.invite_code:
        invite.used_by = user.id
        invite.used_at = datetime.now()

    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@app.post("/api/auth/login", response_model=TokenResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data.username).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if not user.is_approved:
        raise HTTPException(status_code=403, detail="账号待审核，请联系管理员")

    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(access_token=token)


@app.get("/api/auth/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return UserOut.model_validate(current_user)


@app.put("/api/auth/password")
def change_password(
    data: LoginRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if len(data.password) < 4:
        raise HTTPException(status_code=400, detail="密码至少 4 个字符")
    current_user.password_hash = hash_password(data.password)
    db.commit()
    return {"ok": True}


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
    status: Optional[str] = Query(None),
    shop: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    q = db.query(Account)
    if shop:
        q = q.filter(Account.shop == shop)
    if search:
        pattern = f"%{search}%"
        q = q.filter(
            (Account.email.ilike(pattern))
            | (Account.redeem_key.ilike(pattern))
            | (Account.remark.ilike(pattern))
        )
    if account_type:
        q = q.filter(Account.account_type == account_type)
    if status:
        q = q.filter(Account.status == status)

    accounts = q.order_by(Account.id.desc()).all()
    return [AccountOut.model_validate(a) for a in accounts]


@app.post("/api/accounts", response_model=AccountOut)
def create_account(
    data: AccountCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = db.query(Account).filter(Account.redeem_key == data.redeem_key).first()
    if existing:
        raise HTTPException(status_code=400, detail="该兑换密钥已存在")

    account = Account(**data.model_dump(), created_by=current_user.id)
    db.add(account)
    db.commit()
    db.refresh(account)
    return AccountOut.model_validate(account)


@app.post("/api/accounts/redeem", response_model=AccountOut)
async def redeem_account(
    req: RedeemRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
        code_url=info.get("code_url"),
        redeemed_at=info.get("redeemed_at") or datetime.now().strftime("%Y-%m-%d %H:%M"),
        status="available",
        created_by=current_user.id,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return AccountOut.model_validate(account)


@app.put("/api/accounts/{account_id}", response_model=AccountOut)
def update_account(
    account_id: int,
    data: AccountUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")

    update_data = data.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(account, k, v)

    db.commit()
    db.refresh(account)
    return AccountOut.model_validate(account)


@app.delete("/api/accounts/{account_id}")
def delete_account(
    account_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")
    db.delete(account)
    db.commit()
    return {"ok": True}


@app.get("/api/stats", response_model=StatsOut)
def get_stats(
    shop: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    q = db.query(Account)
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
    _user: User = Depends(get_current_user),
):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")
    if not account.code_url:
        raise HTTPException(status_code=400, detail="该账号没有收码链接")

    result = await fetch_verification_code(
        account.email, account.password, account.code_url
    )
    return FetchCodeResponse(**result)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=25487, reload=True)
