import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { getReceiptSummary } = vi.hoisted(() => ({
  getReceiptSummary: vi.fn(),
}))

vi.mock('../services/apiClient', () => ({
  api: { getReceiptSummary },
}))

vi.mock('../components/PullToRefresh', () => ({
  default: ({ onRefresh, children }) => (
    <div>
      <button type="button" onClick={() => void onRefresh()}>
        Pull refresh
      </button>
      {children}
    </div>
  ),
}))

import ReceiptSummarySection from '../components/ReceiptSummarySection'

function renderSection() {
  return render(<ReceiptSummarySection userId="user-1" />)
}

describe('ReceiptSummarySection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getReceiptSummary.mockResolvedValue({
      total_receipts: 0,
      month_spend: 0,
      total_items: 0,
      recent: [],
    })
  })

  it('CARDS_RENDER_SUMMARY_VALUES_FROM_GET_RECEIPT_SUMMARY', async () => {
    getReceiptSummary.mockResolvedValue({
      total_receipts: 4,
      month_spend: 35.5,
      total_items: 14,
      recent: [
        {
          id: 'r1',
          provider: 'costco',
          order_date: '2026-09-15',
          total_amount: 25.5,
          num_items: 3,
        },
      ],
    })

    renderSection()

    await waitFor(() => {
      expect(getReceiptSummary).toHaveBeenCalledWith('user-1')
    })
    expect(await screen.findByText('4')).toBeInTheDocument()
    expect(screen.getByText('$35.50')).toBeInTheDocument()
    expect(screen.getByText('14')).toBeInTheDocument()
    expect(await screen.findByText('costco')).toBeInTheDocument()
  })

  it('HEADING_INCLUDES_YOUR_RECEIPTS', async () => {
    renderSection()
    expect(
      await screen.findByRole('heading', { name: /your receipts/i })
    ).toBeInTheDocument()
  })

  it('EMPTY_SUMMARY_SHOWS_ZEROS_FROM_API', async () => {
    renderSection()

    await waitFor(() => {
      expect(getReceiptSummary).toHaveBeenCalledWith('user-1')
    })
    expect(await screen.findByText('$0.00')).toBeInTheDocument()
    const zeros = screen.getAllByText('0')
    expect(zeros.length).toBeGreaterThanOrEqual(2)
    expect(await screen.findByText(/no receipts yet/i)).toBeInTheDocument()
  })

  it('REFRESH_CALLS_SUMMARY_AGAIN', async () => {
    renderSection()

    await waitFor(() => {
      expect(getReceiptSummary).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByRole('button', { name: /pull refresh/i }))

    await waitFor(() => {
      expect(getReceiptSummary).toHaveBeenCalledTimes(2)
    })
    expect(getReceiptSummary).toHaveBeenNthCalledWith(2, 'user-1')
  })
})
