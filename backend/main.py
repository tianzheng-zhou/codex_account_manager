from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import Optional
import os

from database import engine, get_db, Base
from models import Account
from schemas import (
    AccountCreate,
    AccountUpdate,
    AccountOut,
    RedeemRequest,
    StatsOut,
    FetchCodeResponse,
)
from scraper import redeem_key
from mailbox import fetch_verification_code

Base.metadata.create_all(bind=engine)

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


@app.get("/api/accounts")
def list_accounts(
    search: Optional[str] = Query(None),
    account_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(Account)
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
def create_account(data: AccountCreate, db: Session = Depends(get_db)):
    existing = db.query(Account).filter(Account.redeem_key == data.redeem_key).first()
    if existing:
        raise HTTPException(status_code=400, detail="该兑换密钥已存在")

    account = Account(**data.model_dump())
    db.add(account)
    db.commit()
    db.refresh(account)
    return AccountOut.model_validate(account)


@app.post("/api/accounts/redeem", response_model=AccountOut)
async def redeem_account(req: RedeemRequest, db: Session = Depends(get_db)):
    existing = db.query(Account).filter(Account.redeem_key == req.key).first()
    if existing:
        raise HTTPException(status_code=400, detail="该兑换密钥已录入系统")

    result = await redeem_key(req.key)
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result.get("error", "兑换失败"))

    info = result["data"]
    account = Account(
        redeem_key=req.key,
        account_type=info.get("account_type", "Team"),
        email=info["email"],
        password=info["password"],
        code_url=info.get("code_url"),
        redeemed_at=info.get("redeemed_at"),
        status="available",
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return AccountOut.model_validate(account)


@app.put("/api/accounts/{account_id}", response_model=AccountOut)
def update_account(
    account_id: int, data: AccountUpdate, db: Session = Depends(get_db)
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
def delete_account(account_id: int, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")
    db.delete(account)
    db.commit()
    return {"ok": True}


@app.get("/api/stats", response_model=StatsOut)
def get_stats(db: Session = Depends(get_db)):
    all_accounts = db.query(Account).all()
    return StatsOut(
        total=len(all_accounts),
        team=sum(1 for a in all_accounts if a.account_type == "Team"),
        plus=sum(1 for a in all_accounts if a.account_type == "Plus"),
        available=sum(1 for a in all_accounts if a.status == "available"),
        assigned=sum(1 for a in all_accounts if a.status == "assigned"),
        expired=sum(1 for a in all_accounts if a.status == "expired"),
    )


@app.post("/api/accounts/{account_id}/fetch-code", response_model=FetchCodeResponse)
async def fetch_code(account_id: int, db: Session = Depends(get_db)):
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
