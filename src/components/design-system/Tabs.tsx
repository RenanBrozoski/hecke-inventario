'use client'

import { useRef } from 'react'
import type { KeyboardEvent } from 'react'

export interface TabItem {
  id: string
  label: string
}

interface TabsProps {
  tabs: TabItem[]
  activeTab: string
  onChange: (tabId: string) => void
  /** Painel(éis) já filtrado(s) pelo chamador (`activeTab === 'x' && <X />`) — o
   * componente só cuida da navegação por abas, não decide o que renderizar. */
  children: React.ReactNode
  /** Usado para compor `id`s únicos entre `tab`/`tabpanel` quando há mais de
   * um `Tabs` na mesma página. */
  idPrefix?: string
}

/**
 * Tabs simples seguindo o padrão WAI-ARIA (https://www.w3.org/WAI/ARIA/apg/patterns/tabs/):
 * `role="tablist"` > `role="tab"` (com `aria-selected`/`tabIndex` roving) e um
 * `role="tabpanel"` associado por `aria-labelledby`/`aria-controls`. Setas
 * esquerda/direita movem o foco (e a seleção) entre abas; Home/End vão para a
 * primeira/última. Não há biblioteca de terceiros instalada para isso —
 * construído do zero sobre os tokens de `app/globals.css`.
 */
export function Tabs({ tabs, activeTab, onChange, children, idPrefix = 'tabs' }: TabsProps) {
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  function focusTab(tabId: string) {
    tabRefs.current.get(tabId)?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = tabs.length - 1
    if (nextIndex === null) return

    event.preventDefault()
    const nextTab = tabs[nextIndex]!
    onChange(nextTab.id)
    focusTab(nextTab.id)
  }

  return (
    <div className="tabs">
      <div className="tabs__list" role="tablist">
        {tabs.map((tab, index) => {
          const selected = tab.id === activeTab
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.id, el)
                else tabRefs.current.delete(tab.id)
              }}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${idPrefix}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className={`tabs__tab ${selected ? 'tabs__tab--active' : ''}`}
              onClick={() => onChange(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      <div
        className="tabs__panel"
        role="tabpanel"
        id={`${idPrefix}-panel-${activeTab}`}
        aria-labelledby={`${idPrefix}-tab-${activeTab}`}
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  )
}
