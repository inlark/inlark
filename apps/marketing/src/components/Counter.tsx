import { useState } from 'react'

export function Counter() {
  const [count, setCount] = useState(0)

  return (
    <button
      type="button"
      onClick={() => setCount((current) => current + 1)}
      className="cursor-pointer rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
    >
      Count: {count}
    </button>
  )
}
