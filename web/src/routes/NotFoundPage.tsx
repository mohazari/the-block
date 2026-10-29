import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <section className="mx-auto max-w-md py-16 text-center">
      <h1 className="font-display text-3xl font-bold">Nothing on this lane</h1>
      <p className="text-ink-muted mt-2">
        That page doesn't exist. The inventory is a good place to start.
      </p>
      <Link
        to="/"
        className="bg-action text-action-ink hover:bg-action-hover mt-6 inline-block rounded-[var(--radius-control)] px-4 py-2 font-semibold"
      >
        Browse inventory
      </Link>
    </section>
  )
}
