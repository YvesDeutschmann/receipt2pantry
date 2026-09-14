import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import HouseholdSizePicker, { getSizeLabel } from '../components/onboarding/HouseholdSizePicker'

describe('HouseholdSizePicker', () => {
  it('SIZE_LABEL_COOKING_FOR_TWO', () => {
    expect(getSizeLabel(2)).toBe('Cooking for 2')
  })

  it('DECREMENT_DISABLED_AT_MIN', () => {
    const onSizeChange = vi.fn()
    render(<HouseholdSizePicker size={1} onSizeChange={onSizeChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Decrease/i }))
    expect(onSizeChange).not.toHaveBeenCalled()
  })

  it('INCREMENT_CALLS_ON_SIZE_CHANGE', () => {
    const onSizeChange = vi.fn()
    render(<HouseholdSizePicker size={3} onSizeChange={onSizeChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Increase/i }))
    expect(onSizeChange).toHaveBeenCalledWith(4)
  })

  it('AT_MAX_SHOWS_MANUAL_INPUT_AND_ACCEPTS_11_99', () => {
    const onSizeChange = vi.fn()
    render(<HouseholdSizePicker size={10} onSizeChange={onSizeChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Increase/i }))
    const input = screen.getByPlaceholderText('11–99')
    fireEvent.change(input, { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: /^Set$/i }))
    expect(onSizeChange).toHaveBeenCalledWith(15)
  })
})
