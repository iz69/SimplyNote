// src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import './i18n'
import App from './App'
import Login from './Login'

import { basePath } from "./utils"

async function bootstrap() {

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter basename={basePath()}>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<App />} />
        </Routes>
      </BrowserRouter>
    </StrictMode>
  )
}

bootstrap() 
