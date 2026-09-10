import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import AdaptiveModal, { APP_OVERLAY_Z_CLASS } from '../components/AdaptiveModal'

const useMediaQueryMock = vi.fn(() => false)

vi.mock('../hooks/useMediaQuery', () => ({
  useMediaQuery: (...args) => useMediaQueryMock(...args),
}))

describe('AdaptiveModal footer slot', () => {
  beforeEach(() => {
    useMediaQueryMock.mockReturnValue(false)
    document.body.style.overflow = ''
  })

  afterEach(() => {
    cleanup()
    document.body.style.overflow = ''
  })

  it('renders_footer_outside_scroll_region', () => {
    render(
      <AdaptiveModal
        isOpen
        onClose={() => {}}
        title="Recipe"
        footer={<button type="button">Cooked it</button>}
      >
        <p>Long instructions go here</p>
      </AdaptiveModal>
    )
    const footer = screen.getByTestId('modal-footer')
    const scroll = screen.getByTestId('modal-scroll')
    expect(footer).toHaveTextContent('Cooked it')
    expect(scroll).toHaveTextContent('Long instructions go here')
    expect(scroll).not.toContainElement(screen.getByRole('button', { name: /Cooked it/i }))
    expect(footer).not.toContainElement(screen.getByText('Long instructions go here'))
  })

  it('portals_overlay_to_document_body', () => {
    const { container } = render(
      <AdaptiveModal isOpen onClose={() => {}} title="Recipe">
        <p>Body content</p>
      </AdaptiveModal>
    )
    const overlay = screen.getByTestId('adaptive-modal-overlay')
    expect(document.body).toContainElement(overlay)
    expect(container).not.toContainElement(overlay)
  })

  it('uses_app_overlay_z_class', () => {
    render(
      <AdaptiveModal isOpen onClose={() => {}} title="Recipe">
        <p>Body content</p>
      </AdaptiveModal>
    )
    const overlay = screen.getByTestId('adaptive-modal-overlay')
    expect(overlay.className).toContain(APP_OVERLAY_Z_CLASS)
  })

  it('mobile_footer_has_pb_safe_bottom', () => {
    useMediaQueryMock.mockReturnValue(true)
    render(
      <AdaptiveModal
        isOpen
        onClose={() => {}}
        title="Recipe"
        footer={<button type="button">Cooked it</button>}
      >
        <p>Steps</p>
      </AdaptiveModal>
    )
    const footer = screen.getByTestId('modal-footer')
    expect(footer.className).toContain('pb-safe-bottom')
  })

  it('restores_body_overflow_on_close', () => {
    document.body.style.overflow = 'scroll'
    const { rerender } = render(
      <AdaptiveModal isOpen onClose={() => {}} title="Recipe">
        <p>Body content</p>
      </AdaptiveModal>
    )
    expect(document.body.style.overflow).toBe('hidden')
    rerender(
      <AdaptiveModal isOpen={false} onClose={() => {}} title="Recipe">
        <p>Body content</p>
      </AdaptiveModal>
    )
    expect(document.body.style.overflow).toBe('scroll')
  })
})
