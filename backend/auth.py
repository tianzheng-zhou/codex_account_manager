import os
import secrets
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
import bcrypt
from sqlalchemy.orm import Session

from database import get_db, SessionLocal
from models import User

# ---- Config ----
SECRET_KEY = os.environ.get("JWT_SECRET_KEY", secrets.token_urlsafe(32))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 72

# ---- Password hashing ----
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ---- JWT ----
def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# ---- Dependencies ----
bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录",
        )
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id_str = payload.get("sub")
        if user_id_str is None:
            raise HTTPException(status_code=401, detail="无效的 token")
        user_id = int(user_id_str)
    except JWTError:
        raise HTTPException(status_code=401, detail="无效的 token")

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=401, detail="用户不存在")
    if not user.is_approved:
        raise HTTPException(status_code=403, detail="账号待审核，请联系管理员")
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return current_user


# ---- Bootstrap default admin ----
def ensure_default_admin():
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.role == "admin").first()
        if admin is None:
            admin = User(
                username="admin",
                password_hash=hash_password("admin"),
                role="admin",
                is_approved=True,
            )
            db.add(admin)
            db.commit()
            print("=" * 50)
            print("  默认管理员已创建：admin / admin")
            print("  请登录后立即修改密码！")
            print("=" * 50)
    finally:
        db.close()
