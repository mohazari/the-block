import { afterEach, describe, expect, it, vi } from 'vitest'
import { serverNow } from '../lib/serverClock'
import { ApiError, api, send, toSearchParams } from './client'
import { noteHello, noteStreamDown, onReseed } from './dataEpoch'

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi
    .fn()
    .mockResolvedValue(
      new Response(body === null ? null : JSON.stringify(body), { status, headers }),
    )
}

afterEach(() => vi.unstubAllGlobals())

describe('toSearchParams', () => {
  it('repeats keys for arrays and drops empty values', () => {
    const params = toSearchParams({
      make: ['Ford', 'BMW'],
      q: '',
      year_min: 2020,
      buy_now: false,
      watching: true,
      price_max: null,
    })
    expect(params.toString()).toBe('make=Ford&make=BMW&year_min=2020&buy_now=false&watching=true')
  })
})

describe('api', () => {
  it('sends the bidder id and idempotency key', async () => {
    const fetchMock = respond(201, { ok: true })
    vi.stubGlobal('fetch', fetchMock)
    await api('/vehicles/1/bids', { method: 'POST', body: { amount: 100 }, idempotencyKey: 'k1' })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/vehicles/1/bids')
    expect(init.headers['X-Bidder-Id']).toMatch(/[0-9a-f-]{36}/)
    expect(init.headers['Idempotency-Key']).toBe('k1')
    expect(init.body).toBe('{"amount":100}')
  })

  it('turns the error envelope into an ApiError with the fresh snapshot', async () => {
    const auction = { min_next_bid: 23800 }
    vi.stubGlobal(
      'fetch',
      respond(
        409,
        { error: { code: 'bid_too_low', message: 'The minimum bid is now $23,800.', auction } },
        { 'Retry-After': '1' },
      ),
    )
    const error = await api<never>('/vehicles/1/bids', { method: 'POST', body: {} }).catch(
      (caught: unknown) => caught as ApiError,
    )
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, code: 'bid_too_low', auction, retryAfterSeconds: 1 })
    expect(error.message).toBe('The minimum bid is now $23,800.')
  })

  it('rejects a successful response that is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>portal</html>')))
    await expect(api('/vehicles')).rejects.toMatchObject({ code: 'bad_response' })
  })

  it('reports network failures as a readable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(api('/vehicles')).rejects.toMatchObject({ code: 'network_error' })
  })

  it('syncs the server clock from responses', async () => {
    const serverTime = new Date(Date.now() + 120_000).toISOString()
    vi.stubGlobal('fetch', respond(200, { server_time: serverTime, items: [] }))
    await api('/vehicles')
    expect(Math.abs(serverNow() - Date.parse(serverTime))).toBeLessThan(1_000)
  })

  it('rejects a read that was in flight when the data was reset, so it is read again', async () => {
    noteHello('run-1', 'old')
    let answer!: (response: Response) => void
    vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => (answer = resolve)))
    const read = api('/vehicles')
    await vi.waitFor(() => expect(answer).toBeDefined())
    noteHello('run-2', 'new') // a hello reports the reset while the read is in flight
    answer(new Response('{"items": []}'))
    await expect(read).rejects.toMatchObject({ code: 'data_reset', status: 0 })
  })

  it('still returns a bid response that was in flight across a reset', async () => {
    noteHello('run-1', 'old')
    let answer!: (response: Response) => void
    vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => (answer = resolve)))
    const bid = api('/vehicles/veh-1/bids', { method: 'POST', body: { amount: 1 } })
    await vi.waitFor(() => expect(answer).toBeDefined())
    noteHello('run-2', 'new')
    answer(new Response('{"ok": true}', { status: 201 }))
    await expect(bid).resolves.toEqual({ ok: true }) // the outcome is shown, not thrown away
  })

  it('learns of a reseed from any response, whose data is the new data', async () => {
    noteHello('run-1', 'old')
    noteStreamDown() // a tab whose stream is down: responses are its only news
    const reseeded = vi.fn()
    const stop = onReseed(reseeded)
    const headers = { 'X-Server-Run': 'run-2', 'X-Data-Epoch': 'new' } // reseeded since
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"items": []}', { headers })))
    await expect(api('/vehicles')).resolves.toEqual({ items: [] }) // from run-2: usable
    expect(reseeded).toHaveBeenCalledTimes(1) // and the old cache is dropped
    stop()
  })

  it('rereads a response from a run the tab has moved on from', async () => {
    noteHello('run-1', 'old')
    noteHello('run-2', 'new')
    const headers = { 'X-Server-Run': 'run-1', 'X-Data-Epoch': 'old' } // a late straggler
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"items": []}', { headers })))
    await expect(api('/vehicles')).rejects.toMatchObject({ code: 'data_reset', status: 0 })
  })

  it("marks a bid answered from other data, so its snapshot isn't applied", async () => {
    noteHello('run-1', 'old')
    noteHello('run-2', 'new')
    const headers = { 'X-Server-Run': 'run-1', 'X-Data-Epoch': 'old' }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"ok": 1}', { status: 201, headers })),
    )
    const placed = await send('/vehicles/veh-1/bids', { method: 'POST', body: { amount: 1 } })
    expect(placed).toEqual({ data: { ok: 1 }, sameData: false }) // the outcome stands, flagged
  })
})
