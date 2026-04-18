import { expect } from 'vitest'

/**
 * INV-01: No browser-style confirmation for add/remove flows (no alert/confirm patterns).
 * Does not apply to intentional "Save draft?" dismissal dialogs.
 */
export function expectNoAddRemoveConfirmationDialog(screen) {
  expect(
    screen.queryByRole('alertdialog', { name: /are you sure|confirm delete|delete permanently/i })
  ).toBeNull()
}

/**
 * INV-03: Primary action not blocked (enabled, not busy).
 */
export function expectNotBlocked(button) {
  expect(button).not.toBeDisabled()
  expect(button).not.toHaveAttribute('aria-busy', 'true')
}
