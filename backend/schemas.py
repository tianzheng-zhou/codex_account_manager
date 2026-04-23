from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class AccountBase(BaseModel):
    redeem_key: str
    shop: str = "gpt-cw"
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
    shop: Optional[str] = None
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
    shop: str = "gpt-cw"


class StatsOut(BaseModel):
    total: int
    team: int
    plus: int
    available: int
    archived: int
    shop: Optional[str] = None


class FetchCodeResponse(BaseModel):
    code: Optional[str] = None
    subject: Optional[str] = None
    received_at: Optional[str] = None
    error: Optional[str] = None


# ---- Auth Schemas ----

class RegisterRequest(BaseModel):
    username: str
    password: str
    invite_code: Optional[str] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    is_approved: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class InviteCodeOut(BaseModel):
    id: int
    code: str
    created_by: Optional[int] = None
    used_by: Optional[int] = None
    created_at: Optional[datetime] = None
    used_at: Optional[datetime] = None

    class Config:
        from_attributes = True
