from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr
from app.deps import db, current_user
from app.core.security import hash_password, verify_password, create_token
from app.core.errors import AppError, Unauthorized

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterIn(BaseModel):
    name: str
    email: EmailStr
    password: str


class LoginIn(BaseModel):
    email: EmailStr
    password: str


@router.post("/register")
async def register(body: RegisterIn, conn=Depends(db)):
    exists = await conn.fetchrow("SELECT 1 FROM users WHERE email=$1", body.email)
    if exists:
        raise AppError("Bu e-posta zaten kayıtlı.")
    row = await conn.fetchrow(
        "INSERT INTO users (name, email, password_hash) VALUES ($1,$2,$3) RETURNING id",
        body.name, body.email, hash_password(body.password),
    )
    uid = str(row["id"])
    return {"token": create_token(uid), "user": {"id": uid, "name": body.name, "email": body.email}}


@router.post("/login")
async def login(body: LoginIn, conn=Depends(db)):
    row = await conn.fetchrow("SELECT id, name, email, password_hash FROM users WHERE email=$1", body.email)
    if not row or not verify_password(body.password, row["password_hash"]):
        raise Unauthorized("E-posta veya şifre hatalı.")
    uid = str(row["id"])
    return {"token": create_token(uid), "user": {"id": uid, "name": row["name"], "email": row["email"]}}


@router.get("/me")
async def me(user=Depends(current_user)):
    return {"user": {"id": str(user["id"]), "name": user["name"], "email": user["email"]}}
