import { describe, expect, it } from 'vitest'
import { auction } from '../test/fixtures'
import { amountProblem } from './bidRules'

const open = auction({ min_next_bid: 23300, max_bid: 69900 })

describe('amountProblem', () => {
  it('accepts the minimum and anything up to the cap', () => {
    expect(amountProblem(23300, open)).toBeNull()
    expect(amountProblem(69900, open)).toBeNull()
  })

  it('explains each way an amount can be wrong', () => {
    expect(amountProblem(null, open)).toBe('Enter a bid amount.')
    expect(amountProblem(23300.5, open)).toBe('Bids are in whole dollars.')
    expect(amountProblem(23299, open)).toBe('The minimum bid is $23,300.')
    expect(amountProblem(69901, open)).toBe(
      "That's above the largest single bid allowed ($69,900). Check the amount.",
    )
  })

  it('points to Buy Now when a bid would reach it', () => {
    const withBuyNow = auction({
      min_next_bid: 23300,
      buy_now_available: true,
      buy_now_price: 28000,
    })
    expect(amountProblem(28000, withBuyNow)).toBe(
      "That's at or above Buy Now. Buy it now for $28,000 instead.",
    )
    expect(amountProblem(27900, withBuyNow)).toBeNull()
  })
})
