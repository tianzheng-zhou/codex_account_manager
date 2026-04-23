import os
import secrets
import time
from datetime import datetime, timedelta
from threading import Lock

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
import bcrypt
from sqlalchemy.orm import Session

from database import get_db, SessionLocal
from models import User

# ---- Config ----
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 72
MIN_PASSWORD_LENGTH = 8

# Persist SECRET_KEY so tokens survive restarts.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SECRET_FILE = os.path.join(_PROJECT_ROOT, ".jwt_secret")


def _load_or_create_secret() -> str:
    env_key = os.environ.get("JWT_SECRET_KEY")
    if env_key:
        return env_key
    try:
        if os.path.exists(_SECRET_FILE):
            with open(_SECRET_FILE, "r", encoding="utf-8") as f:
                k = f.read().strip()
                if k:
                    return k
        k = secrets.token_urlsafe(48)
        with open(_SECRET_FILE, "w", encoding="utf-8") as f:
            f.write(k)
        try:
            os.chmod(_SECRET_FILE, 0o600)
        except Exception:
            pass
        return k
    except Exception:
        # Fallback: ephemeral key if filesystem is read-only.
        return secrets.token_urlsafe(48)


SECRET_KEY = _load_or_create_secret()

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


def get_effective_role(
    request: Request,
    current_user: User = Depends(get_current_user),
) -> str:
    """Resolve the effective role, respecting the admin privacy toggle.

    Admin users may send header `X-Admin-View: user` to temporarily act as a
    regular user (list/filter-wise). The toggle never grants extra privileges.
    """
    if current_user.role == "admin":
        hdr = (request.headers.get("X-Admin-View") or "").strip().lower()
        if hdr == "user":
            return "user"
    return current_user.role


# ---- Login rate limiting ----
_login_attempts: dict[str, list[float]] = {}
_login_lock = Lock()
LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_MAX_FAILURES = 10
LOGIN_LOCKOUT_SECONDS = 5 * 60


def _login_bucket_key(username: str, ip: str) -> str:
    return f"{(username or '').lower()}|{ip or ''}"


def check_login_rate_limit(username: str, ip: str):
    now = time.time()
    key = _login_bucket_key(username, ip)
    with _login_lock:
        attempts = _login_attempts.get(key, [])
        attempts = [t for t in attempts if now - t < LOGIN_WINDOW_SECONDS]
        _login_attempts[key] = attempts
        recent = [t for t in attempts if now - t < LOGIN_LOCKOUT_SECONDS]
        if len(recent) >= LOGIN_MAX_FAILURES:
            retry_after = int(LOGIN_LOCKOUT_SECONDS - (now - recent[0]))
            raise HTTPException(
                status_code=429,
                detail=f"登录尝试过多，请 {max(retry_after, 1)} 秒后再试",
                headers={"Retry-After": str(max(retry_after, 1))},
            )


def record_login_failure(username: str, ip: str):
    with _login_lock:
        key = _login_bucket_key(username, ip)
        _login_attempts.setdefault(key, []).append(time.time())


def clear_login_failures(username: str, ip: str):
    with _login_lock:
        _login_attempts.pop(_login_bucket_key(username, ip), None)


# ---- URL sanitisation ----
def sanitize_url(url: str | None) -> str | None:
    """Only allow http(s) URLs; reject javascript:, data:, etc."""
    if url is None:
        return None
    u = url.strip()
    if not u:
        return None
    low = u.lower()
    if low.startswith("http://") or low.startswith("https://"):
        return u
    raise HTTPException(status_code=400, detail="收码链接必须是 http:// 或 https:// 开头")


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
