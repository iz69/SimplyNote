from pydantic import BaseModel
from typing import Optional, List

class NoteCreate(BaseModel):
    title: str
    content: str
    tags: Optional[List[str]] = None

class NoteUpdate(BaseModel):
    title: str
    content: str
    tags: Optional[List[str]] = None

class NoteOut(BaseModel):
    id: int
    title: str
    content: str
    tags: Optional[List[str]] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
