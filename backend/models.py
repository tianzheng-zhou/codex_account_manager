from sqlalchemy import Column, Integer, String, DateTime, func

from database import Base


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    redeem_key = Column(String, unique=True, index=True, nullable=False)
    account_type = Column(String, nullable=False, default="Team")
    email = Column(String, nullable=False)
    password = Column(String, nullable=False)
    code_url = Column(String, nullable=True)
    status = Column(String, nullable=False, default="available")
    remark = Column(String, nullable=True, default="")
    redeemed_at = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
