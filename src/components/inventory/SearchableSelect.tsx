'use client'

import { useEffect, useRef, useState } from 'react'

export type SelectOption = { value: string; label: string }

export function SearchableSelect({
  id,
  value,
  onChange,
  options,
  emptyLabel = 'Todos',
  searchPlaceholder = 'Buscar…',
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  emptyLabel?: string
  searchPlaceholder?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedLabel = options.find((o) => o.value === value)?.label

  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  function select(val: string) {
    onChange(val)
    setOpen(false)
    setQuery('')
  }

  useEffect(() => {
    if (open) inputRef.current?.focus()
    else setQuery('')
  }, [open])

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        id={id}
        type="button"
        onClick={() => setOpen((p) => !p)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '0.4rem 0.6rem',
          border: '1px solid var(--border, #d1d5db)',
          borderRadius: 4,
          background: 'var(--input-bg, var(--card-bg, #fff))',
          color: value ? 'inherit' : 'var(--text-muted, #9ca3af)',
          cursor: 'pointer',
          fontSize: 'inherit',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.25rem',
          minHeight: '2rem',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedLabel ?? emptyLabel}
        </span>
        <span style={{ opacity: 0.45, flexShrink: 0 }}>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 2px)',
            left: 0,
            right: 0,
            zIndex: 200,
            background: 'var(--card-bg, #fff)',
            border: '1px solid var(--border, #d1d5db)',
            borderRadius: 4,
            boxShadow: '0 6px 20px rgba(0,0,0,.12)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 260,
          }}
        >
          <div style={{ padding: '0.3rem' }}>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false)
                if (e.key === 'Enter' && filtered.length === 1 && filtered[0]) select(filtered[0].value)
              }}
              style={{
                width: '100%',
                border: '1px solid var(--border, #d1d5db)',
                borderRadius: 3,
                padding: '0.3rem 0.5rem',
                background: 'var(--input-bg, #f9fafb)',
                fontSize: 'inherit',
                outline: 'none',
              }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <div
              style={{
                padding: '0.35rem 0.6rem',
                cursor: 'pointer',
                color: 'var(--text-muted, #6b7280)',
                borderBottom: '1px solid var(--border, #e5e7eb)',
              }}
              onMouseDown={() => select('')}
            >
              {emptyLabel}
            </div>
            {filtered.length === 0 ? (
              <div style={{ padding: '0.35rem 0.6rem', opacity: 0.5 }}>Nenhum resultado</div>
            ) : (
              filtered.map((o) => (
                <div
                  key={o.value}
                  onMouseDown={() => select(o.value)}
                  style={{
                    padding: '0.35rem 0.6rem',
                    cursor: 'pointer',
                    background: o.value === value ? 'var(--primary-bg, #eff6ff)' : undefined,
                    fontWeight: o.value === value ? 600 : undefined,
                  }}
                >
                  {o.label}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
