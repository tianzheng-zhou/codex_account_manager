from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class AccountBase(BaseModel):
    redeem_key: str
    account_type: str = "Team"
    email: str
    password: str
    code_url: Optional[str] = None
    status: str = "available"
    remark: Optional[str] = ""
    redeemed_at: Optional[str] = None


class AccountCreate(AccountBase):
    pass


class AccountUpdate(BaseModel):
    account_type: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    code_url: Optional[str] = None
    status: Optional[str] = None
    remark: Optional[str] = None


class AccountOut(AccountBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class RedeemRequest(BaseModel):
    key: str


class StatsOut(BaseModel):
    total: int
    team: int
    plus: int
    available: int
    assigned: int
    expired: int


class FetchCodeResponse(BaseModel):
    code: Optional[str] = None
    subject: Optional[str] = None
    received_at: Optional[str] = None
    error: Optional[str] = None
