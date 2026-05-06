import React from 'react'
import ReactDOM from 'react-dom/client'
import { StatusBar, Style } from '@capacitor/status-bar'
import { App as CapApp } from '@capacitor/app'
import App from './App.jsx'
import './index.css'
import { initDeepLinks } from './native/deepLink'
import { isNative } from './utils/platform'
import {
  initApiBaseUrl,
  refreshSyncedApiBaseUrl,
} from './services/apiClient'

// Configure status bar on native platforms
if (isNative()) {
  StatusBar.setOverlaysWebView(true)
  StatusBar.setStyle({ style: Style.Light })
  initDeepLinks()
}

async function bootstrap() {
  await initApiBaseUrl()
  await refreshSyncedApiBaseUrl()
  if (isNative()) {
    void CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        void refreshSyncedApiBaseUrl()
      }
    })
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void bootstrap()
