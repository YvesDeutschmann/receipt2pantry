import { useMemo } from 'react'
import { Capacitor } from '@capacitor/core'

/**
 * Returns the current platform: 'web' | 'ios' | 'android'
 */
export function getPlatform() {
  return Capacitor.getPlatform()
}

/**
 * Returns true when running inside a native Capacitor app (iOS or Android)
 */
export function isNative() {
  const platform = getPlatform()
  return platform === 'ios' || platform === 'android'
}

/**
 * Returns true when running on iOS
 */
export function isIOS() {
  return getPlatform() === 'ios'
}

/**
 * Returns true when running on Android
 */
export function isAndroid() {
  return getPlatform() === 'android'
}

/**
 * Returns true when running in a web browser
 */
export function isWeb() {
  return getPlatform() === 'web'
}

/**
 * React hook that returns the current platform and convenience booleans
 */
export function usePlatform() {
  return useMemo(
    () => ({
      platform: getPlatform(),
      isNative: isNative(),
      isIOS: isIOS(),
      isAndroid: isAndroid(),
      isWeb: isWeb(),
    }),
    []
  )
}
