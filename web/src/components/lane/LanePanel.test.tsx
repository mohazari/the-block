import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LaneModel, LaneStatus } from '../../api/types'
import { FakeEventSource } from '../../test/fakeEventSource'
import { stubApi, vehicle, vehicleDetail, vehicleList } from '../../test/fixtures'
import { renderRoute } from '../../test/render'

afterEach(() => vi.unstubAllGlobals())

const SIGNED_IN: LaneStatus = {
  available: true,
  problem: null,
  signed_in: true,
  plan: 'plus',
  signing_in: false,
  sign_in_error: null,
  usage: { used_percent: 12, window_minutes: 300, resets_at: new Date().toISOString() },
}

const MODELS: LaneModel[] = [
  {
    id: 'large',
    name: 'Large',
    description: '',
    is_default: true,
    default_effort: 'medium',
    efforts: [
      { value: 'low', description: '' },
      { value: 'medium', description: '' },
      { value: 'high', description: '' },
    ],
  },
  {
    id: 'small',
    name: 'Small',
    description: '',
    is_default: false,
    default_effort: 'low',
    efforts: [{ value: 'low', description: '' }],
  },
]

/** An event-stream response; `hold` keeps it open until the returned close() is called. */
function eventStream(events: object[], hold = false) {
  let close = () => {}
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      const push = (event: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      events.forEach(push)
      close = () => {
        push({ type: 'problem', code: 'lane_stopped', message: 'Stopped.' })
        controller.close()
      }
      if (!hold) controller.close()
    },
  })
  return {
    response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    close: () => close(),
  }
}

interface Options {
  status?: LaneStatus
  reply?: () => Response
  onStop?: () => void
}

function serve({ status = SIGNED_IN, reply, onStop }: Options = {}) {
  const sent: Record<string, unknown>[] = []
  const api = stubApi((url, init) => {
    switch (url.pathname) {
      case '/api/vehicles':
        return vehicleList([vehicle()])
      case '/api/vehicles/veh-1':
        return vehicleDetail()
      case '/api/lane/status':
        return status
      case '/api/lane/models':
        return MODELS
      case '/api/lane/sign-in':
        return { auth_url: 'https://auth.example/start' }
      case '/api/lane/messages':
        sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return reply?.() ?? eventStream([]).response
    }
    if (url.pathname.endsWith('/stop')) onStop?.()
    return undefined
  })
  vi.stubGlobal('fetch', api.fetch)
  return { api, sent }
}

/** The visible conversation (the screen-reader announcement repeats the last answer). */
const conversation = (lane: ReturnType<typeof within>) =>
  within(lane.getByRole('list', { name: 'Conversation' }))

async function openLane() {
  // findBy: while a closing panel animates out, the page behind it is still hidden.
  await userEvent.click(await screen.findByRole('button', { name: /Ask Lane/ }))
  return within(await screen.findByRole('dialog', { name: 'Lane' }))
}

describe('Lane', () => {
  it('asks the buyer to sign in with ChatGPT first', async () => {
    const tab = { opener: {}, location: { href: '' }, close: vi.fn() }
    vi.stubGlobal(
      'open',
      vi.fn(() => tab),
    )
    serve({ status: { ...SIGNED_IN, signed_in: false, usage: null } })
    renderRoute('/')
    const lane = await openLane()

    await userEvent.click(await lane.findByRole('button', { name: 'Sign in with ChatGPT' }))
    await waitFor(() => expect(tab.location.href).toBe('https://auth.example/start'))
    expect(tab.opener).toBeNull()
    expect(lane.queryByRole('textbox', { name: 'Message Lane' })).not.toBeInTheDocument()
  })

  it("explains when Lane isn't set up", async () => {
    serve({
      status: { ...SIGNED_IN, available: false, signed_in: false, problem: 'Lane needs Codex.' },
    })
    renderRoute('/')
    const lane = await openLane()
    expect(await lane.findByText('Lane needs Codex.')).toBeInTheDocument()
  })

  it('streams the answer, then shows the picks and their search', async () => {
    const pick = vehicle({ id: 'veh-9', model: 'Escape' })
    const { sent } = serve({
      reply: () =>
        eventStream([
          { type: 'step', label: 'Searching the run list' },
          { type: 'text', delta: 'One SUV ' },
          { type: 'text', delta: 'fits.' },
          {
            type: 'reply',
            message: 'One SUV fits.',
            picks: [{ vehicle: pick, reason: 'Low kilometres, reserve met.' }],
            search: { body_style: ['SUV'], price_max: 30000 },
          },
        ]).response,
    })
    renderRoute('/')
    const lane = await openLane()

    await userEvent.type(
      await lane.findByRole('textbox', { name: 'Message Lane' }),
      'An SUV{Enter}',
    )
    const card = await lane.findByRole('article', { name: '2023 Ford Escape' })
    expect(conversation(lane).getByText('One SUV fits.')).toBeInTheDocument()
    expect(within(card).getByText('Low kilometres, reserve met.')).toBeInTheDocument()
    expect(within(card).getByRole('link')).toHaveAttribute('href', '/vehicles/veh-9')
    expect(lane.getByRole('link', { name: 'Show this search in the run list' })).toHaveAttribute(
      'href',
      '/?body_style=SUV&price_max=30000',
    )
    expect(sent[0]).toMatchObject({ text: 'An SUV', vehicle_id: null })
    expect(sent[0]!.conversation_id).toEqual(expect.any(String))
    expect(sent[0]!.time_zone).toEqual(expect.any(String))
    // Screen readers hear the finished answer once.
    expect(lane.getByText('One SUV fits. 1 pick below.')).toBeInTheDocument()
  })

  it("keeps a pick's price live after Lane answered", async () => {
    const pick = vehicle({ id: 'veh-9', model: 'Escape' })
    serve({
      reply: () =>
        eventStream([
          {
            type: 'reply',
            message: 'This one.',
            picks: [{ vehicle: pick, reason: 'Fits.' }],
            search: null,
          },
        ]).response,
    })
    renderRoute('/')
    const lane = await openLane()
    await userEvent.type(await lane.findByRole('textbox', { name: 'Message Lane' }), 'Hi{Enter}')
    const card = await lane.findByRole('article', { name: '2023 Ford Escape' })
    expect(within(card).getByText('$22,800')).toBeInTheDocument()

    // A rival outbids after the reply: the card follows the live auction.
    const bid = {
      id: 99,
      amount: 23300,
      bidder: 'Bidder 2',
      is_you: false,
      placed_at: new Date().toISOString(),
    }
    FakeEventSource.latest().emit('bid', {
      type: 'bid',
      vehicle_id: 'veh-9',
      vehicle_title: '2023 Ford Escape',
      auction: { ...pick.auction, current_bid: 23300, bid_count: 17 },
      bid,
      outbid_you: false,
      extended: false,
    })
    expect(await within(card).findByText('$23,300', {}, { timeout: 2500 })).toBeInTheDocument()
  })

  it('sends the chosen model and effort, and remembers them', async () => {
    const { sent } = serve()
    renderRoute('/')
    const lane = await openLane()

    await userEvent.click(await lane.findByRole('button', { name: 'Lane settings' }))
    const model = await lane.findByRole('combobox', { name: 'Model' })
    await waitFor(() => expect(model).toHaveValue('large'))
    expect(lane.getByRole('combobox', { name: 'Effort' })).toHaveValue('medium')
    expect(lane.getByText(/12%/)).toBeInTheDocument()

    await userEvent.selectOptions(model, 'small')
    const effort = lane.getByRole('combobox', { name: 'Effort' })
    expect(
      within(effort)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Low'])
    expect(effort).toHaveValue('low')

    await userEvent.click(
      lane.getByRole('button', { name: 'An SUV under $30,000 with low kilometres' }),
    )
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ model: 'small', effort: null })
    expect(JSON.parse(localStorage.getItem('the-block:lane-choice')!)).toEqual({
      model: 'small',
      effort: null,
    })
  })

  it('shows a problem in plain words', async () => {
    serve({
      reply: () =>
        eventStream([
          {
            type: 'problem',
            code: 'lane_usage_limit',
            message: "Your ChatGPT plan's usage limit is used up for now.",
          },
        ]).response,
    })
    renderRoute('/')
    const lane = await openLane()
    await userEvent.type(await lane.findByRole('textbox', { name: 'Message Lane' }), 'Hi{Enter}')
    await waitFor(() =>
      expect(
        conversation(lane).getByText("Your ChatGPT plan's usage limit is used up for now."),
      ).toBeInTheDocument(),
    )
  })

  it('stops an answer on request', async () => {
    const stream = eventStream([{ type: 'step', label: 'Searching the run list' }], true)
    const onStop = vi.fn(() => stream.close())
    serve({ reply: () => stream.response, onStop })
    renderRoute('/')
    const lane = await openLane()

    await userEvent.type(await lane.findByRole('textbox', { name: 'Message Lane' }), 'Hi{Enter}')
    expect(await lane.findByText('Searching the run list…')).toBeInTheDocument()
    await userEvent.click(lane.getByRole('button', { name: 'Stop answering' }))
    expect(onStop).toHaveBeenCalled()
    await waitFor(() => expect(conversation(lane).getByText('Stopped.')).toBeInTheDocument())
    expect(lane.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('knows which car the buyer is looking at', async () => {
    const { sent } = serve()
    renderRoute('/vehicles/veh-1')
    await screen.findByRole('heading', { name: '2023 Ford Bronco' })
    const lane = await openLane()
    await userEvent.click(await lane.findByRole('button', { name: 'Is this car a good buy?' }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ text: 'Is this car a good buy?', vehicle_id: 'veh-1' })
  })

  it('closes on Escape and gives focus back to its button', async () => {
    serve()
    renderRoute('/')
    await openLane()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Ask Lane/ })).toHaveFocus()
  })

  it('keeps the conversation while closed, and starts afresh on "New chat"', async () => {
    serve({
      reply: () =>
        eventStream([{ type: 'reply', message: 'Noted.', picks: [], search: null }]).response,
    })
    renderRoute('/')
    let lane = await openLane()
    await userEvent.type(await lane.findByRole('textbox', { name: 'Message Lane' }), 'Hi{Enter}')
    await waitFor(() => expect(conversation(lane).getByText('Noted.')).toBeInTheDocument())

    await userEvent.click(lane.getByRole('button', { name: 'Close Lane' }))
    lane = await openLane()
    await waitFor(() => expect(conversation(lane).getByText('Noted.')).toBeInTheDocument())

    await userEvent.click(lane.getByRole('button', { name: 'New chat' }))
    expect(lane.queryByRole('list', { name: 'Conversation' })).not.toBeInTheDocument()
    expect(lane.getByRole('list', { name: 'Suggestions' })).toBeInTheDocument()
  })
})
