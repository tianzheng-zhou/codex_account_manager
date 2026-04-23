from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, UniqueConstraint, func

from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, default="user")  # "admin" or "user"
    is_approved = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, server_default=func.now())


class InviteCode(Base):
    __tablename__ = "invite_codes"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    code = Column(String, unique=True, index=True, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    used_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    used_at = Column(DateTime, nullable=True)


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    redeem_key = Column(String, unique=True, index=True, nullable=False)
    shop = Column(String, nullable=False, default="gpt-cw", index=True)
    account_type = Column(String, nullable=False, default="Team")
    email = Column(String, nullable=False)
    password = Column(String, nullable=False)
    code_url = Column(String, nullable=True)
    status = Column(String, nullable=False, default="available")
    remark = Column(String, nullable=True, default="")
    redeemed_at = Column(String, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class AccountShare(Base):
    __tablename__ = "account_shares"
    __table_args__ = (UniqueConstraint("account_id", "user_id", name="uix_account_user"),)

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now())
