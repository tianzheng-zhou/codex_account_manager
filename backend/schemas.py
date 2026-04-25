from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class AccountBase(BaseModel):
    redeem_key: Optional[str] = None
    shop: str = "gpt-cw"
    account_type: str = "Team"
    email: str
    password: str
    recovery_email: Optional[str] = None
    mail_auth_code: Optional[str] = None
    mail_token: Optional[str] = None
    account_provider: Optional[str] = None
    login_method: Optional[str] = None
    code_url: Optional[str] = None
    status: str = "available"
    remark: Optional[str] = ""
    redeemed_at: Optional[str] = None
    team_role: Optional[str] = None
    team_parent_id: Optional[int] = None


class AccountCreate(AccountBase):
    pass


class AccountUpdate(BaseModel):
    shop: Optional[str] = None
    account_type: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    recovery_email: Optional[str] = None
    mail_auth_code: Optional[str] = None
    mail_token: Optional[str] = None
    account_provider: Optional[str] = None
    login_method: Optional[str] = None
    code_url: Optional[str] = None
    status: Optional[str] = None
    remark: Optional[str] = None
    team_role: Optional[str] = None
    team_parent_id: Optional[int] = None


class AccountOut(AccountBase):
    id: int
    created_by: Optional[int] = None
    owner_username: Optional[str] = None
    shared_with: list[dict] = []
    relation: str = "owner"  # "owner" | "shared" | "admin" | "orphan"
    team_parent_label: Optional[str] = None
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


class TeamParentCandidate(BaseModel):
    id: int
    email: str
    redeem_key: str
    owner_username: Optional[str] = None
    remark: Optional[str] = None


class SelfImportRequest(BaseModel):
    raw_text: str
    account_type: str = "Plus"
    team_role: Optional[str] = None
    team_parent_id: Optional[int] = None


class SelfImportError(BaseModel):
    line: int
    raw: str
    error: str


class SelfImportResponse(BaseModel):
    created: int
    failed: int
    accounts: list[AccountOut] = []
    errors: list[SelfImportError] = []


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


class UserBrief(BaseModel):
    """Minimal info returned to non-admin users (e.g., owner name, share list)."""
    id: int
    username: str

    class Config:
        from_attributes = True


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class ShareRequest(BaseModel):
    username: str


class TransferRequest(BaseModel):
    username: str


class ClaimRequest(BaseModel):
    username: str


class InviteCodeOut(BaseModel):
    id: int
    code: str
    created_by: Optional[int] = None
    used_by: Optional[int] = None
    created_at: Optional[datetime] = None
    used_at: Optional[datetime] = None

    class Config:
        from_attributes = True
