import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <section className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Nothing on this lane</h1>
      <p className="text-ink-muted mt-2">
        That page doesn't exist. The inventory is a good place to start.
      </p>
      <Link to="/" className="btn btn-primary mt-6">
        Browse inventory
      </Link>
    </section>
  )
}
