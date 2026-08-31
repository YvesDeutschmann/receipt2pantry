import React from 'react'
import ReactDOM from 'react-dom/client'
import { StatusBar, Style } from '@capacitor/status-bar'
import { App as CapApp } from '@capacitor/app'
import App from './App.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'
import './index.css'
import { initDeepLinks } from './native/deepLink'
import { isNative } from './utils/platform'
import {
  initApiBaseUrl,
  refreshSyncedApiBaseUrl,
  shouldSyncApiBaseFromSupabase,
} from './services/apiClient'
import { initMonitoring } from './services/monitoring'
import { flush as flushFunnelTelemetry } from './services/funnelTelemetry'
import { flush as flushSyncEventLog } from './services/syncEventLog'

initMonitoring()

// Configure status bar on native platforms
if (isNative()) {
  StatusBar.setOverlaysWebView(true)
  StatusBar.setStyle({ style: Style.Light })
  initDeepLinks()
}

async function bootstrap() {
  await initApiBaseUrl()
  if (shouldSyncApiBaseFromSupabase()) {
    await refreshSyncedApiBaseUrl()
  }
  if (isNative()) {
    void CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        if (shouldSyncApiBaseFromSupabase()) {
          void refreshSyncedApiBaseUrl()
        }
        void flushFunnelTelemetry()
        void flushSyncEventLog()
      }
    })
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </React.StrictMode>,
  )
}

void bootstrap()
