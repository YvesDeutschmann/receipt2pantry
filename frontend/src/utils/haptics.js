import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { isNative } from './platform'

/**
 * Light haptic impact feedback (e.g. tab switch, selection change)
 */
export async function hapticImpact(style = ImpactStyle.Light) {
  if (!isNative()) return
  try {
    await Haptics.impact({ style })
  } catch {
    // Ignore - plugin may not be available
  }
}

/**
 * Notification haptic (success, warning, error)
 */
export async function hapticNotification(type = NotificationType.Success) {
  if (!isNative()) return
  try {
    await Haptics.notification({ type })
  } catch {
    // Ignore
  }
}

/**
 * Selection change feedback (e.g. tab switch, toggle, picker scroll)
 */
export async function hapticSelection() {
  if (!isNative()) return
  try {
    await Haptics.impact({ style: ImpactStyle.Light })
  } catch {
    // Ignore
  }
}
