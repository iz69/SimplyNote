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

class FileOut(BaseModel):
    id: int
    filename: str
    url: str

class NoteOut(BaseModel):
    id: int
    title: str
    content: str
    tags: Optional[List[str]] = None
    files: Optional[List[FileOut]] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


