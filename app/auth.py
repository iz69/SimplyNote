from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
from .database import get_connection

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/token")

SECRET_KEY = "simplynote-secret"
ALGORITHM = "HS256"

ACCESS_TOKEN_EXPIRE_MINUTES = 60         # minutes
REFRESH_TOKEN_EXPIRE_DAYS = 30           # days

def hash_password(password: str):
    return pwd_context.hash(password)

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def authenticate_user(username: str, password: str):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE username=?", (username,))
    user = cur.fetchone()
    conn.close()
    if not user:
        return False
    if not verify_password(password, user["password"]):
        return False
    return user

def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Invalid token")

        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM users WHERE username=?", (username,))
        user = cur.fetchone()
        conn.close()

        if not user:
            raise HTTPException(status_code=401, detail="User not found")

        return user

    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

## @router.post("/auth/token")
@router.post("/token")
def login(form_data: OAuth2PasswordRequestForm = Depends()):

    user = authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
#    token = create_access_token({"sub": user["username"]})
#    return {"access_token": token, "token_type": "bearer"}

    access_token = create_access_token(
        {"sub": user["username"]},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))

    refresh_token = create_access_token(
        {"sub": user["username"]},
        expires_delta=timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS))

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer"
    }

## @router.post("/auth/refresh")
@router.post("/refresh")
def refresh_token(payload: dict):

    refresh_token = payload.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Missing refresh_token")

    try:
        data = jwt.decode(refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
        username = data.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token")

    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    new_access_token = create_access_token(
        {"sub": username},
        expires_delta=timedelta(minutes=REFRESH_TOKEN_EXPIRE_DAYS)
    )

    return {"access_token": new_access_token, "token_type": "bearer"}


def init_users(users):

    conn = get_connection()
    cur = conn.cursor()

    # 現在のユーザ一覧を取得
    cur.execute("SELECT username, role FROM users")
    existing_users = cur.fetchall()

    existing_usernames = {row[0] for row in existing_users}
    keep_usernames = {u.get("username", "").strip() for u in users if u.get("username")}

    # DB上に存在するが users に載っていない一般ユーザを削除
    to_delete = [u for u in existing_users if u[1] == "user" and u[0] not in keep_usernames]
    for username, _ in to_delete:
        cur.execute("DELETE FROM users WHERE username=?", (username,))
        logger.info(f"🗑️ Deleted user: {username}")

    # users に載っているが DB に存在しないユーザを追加
    for u in users:
        username = u.get("username", "").strip()
        password = u.get("password", "").strip()[:72]
        role = u.get("role", "user")

        if not username or not password:
            continue

        cur.execute("SELECT id FROM users WHERE username=?", (username,))
        if cur.fetchone():
            continue

        cur.execute(
            "INSERT INTO users (username, password, role, created_at) VALUES (?, ?, ?, ?)",
            (username, hash_password(password), role, datetime.utcnow().isoformat()),
        )

    conn.commit()
    conn.close()




