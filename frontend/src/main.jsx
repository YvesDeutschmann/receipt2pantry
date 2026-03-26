import React from 'react'
import ReactDOM from 'react-dom/client'
import { StatusBar, Style } from '@capacitor/status-bar'
import App from './App.jsx'
import './index.css'
import { initDeepLinks } from './native/deepLink'
import { isNative } from './utils/platform'

// Configure status bar on native platforms
if (isNative()) {
  StatusBar.setOverlaysWebView(true)
  StatusBar.setStyle({ style: Style.Light })
  initDeepLinks()
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

