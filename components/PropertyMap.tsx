'use client'

import { useEffect, useRef, useState } from 'react'

/** One pin: a place with a name, the address shown under it, and where it is. */
export type MapPin = { id: string; title: string; subtitle: string; address: string; latitude: number; longitude: number }

// The little of Leaflet that is used here. Leaflet is loaded as plain files
// from /leaflet (see public/leaflet/README.txt), so it brings no types.
type LeafletMap = {
  setView(center: [number, number], zoom: number): LeafletMap
  fitBounds(bounds: [number, number][], options: { padding: [number, number]; maxZoom: number }): LeafletMap
  invalidateSize(): void
  remove(): void
}
type LeafletMarker = { addTo(map: LeafletMap): LeafletMarker; bindPopup(content: HTMLElement): LeafletMarker; openPopup(): LeafletMarker }
type Leaflet = {
  map(element: HTMLElement, options: { scrollWheelZoom: boolean }): LeafletMap
  tileLayer(url: string, options: { maxZoom: number; attribution: string }): { addTo(map: LeafletMap): unknown }
  marker(position: [number, number], options: { icon: unknown; title: string; alt: string }): LeafletMarker
  divIcon(options: { className: string; html: string; iconSize: [number, number]; iconAnchor: [number, number]; popupAnchor: [number, number] }): unknown
}

/** Street-map pictures come from OpenStreetMap, which asks for this credit on the map. */
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
/** Close enough to see the building and its block. */
const ONE_PIN_ZOOM = 16
const MIN_HEIGHT = 320
/** Room left under the map for the panel's edge and the page's bottom margin. */
const BOTTOM_GAP = 40

let loading: Promise<Leaflet> | null = null

/** Loads Leaflet's style sheet and script once, the first time a map is shown. */
function loadLeaflet(): Promise<Leaflet> {
  if (loading) return loading
  loading = new Promise<Leaflet>((resolve, reject) => {
    const holder = window as unknown as { L?: Leaflet }
    if (holder.L) return resolve(holder.L)
    const style = document.createElement('link')
    style.rel = 'stylesheet'
    style.href = '/leaflet/leaflet.css'
    document.head.appendChild(style)
    const script = document.createElement('script')
    script.src = '/leaflet/leaflet.js'
    script.onload = () => (holder.L ? resolve(holder.L) : reject(new Error('The map tool did not load')))
    script.onerror = () => reject(new Error('The map tool did not load'))
    document.head.appendChild(script)
  })
  loading.catch(() => {
    loading = null // let a later attempt try again
  })
  return loading
}

const googleLink = (pin: MapPin) => `https://www.google.com/maps/search/?api=1&query=${pin.latitude},${pin.longitude}`

/** What a pin shows when clicked. Built as elements, never as HTML text, so names and addresses can't inject anything. */
function popup(pin: MapPin): HTMLElement {
  const box = document.createElement('div')
  box.className = 'map-popup'
  const title = document.createElement('strong')
  title.textContent = pin.title
  box.appendChild(title)
  for (const line of [pin.subtitle, pin.address]) {
    if (!line) continue
    const row = document.createElement('div')
    row.textContent = line
    box.appendChild(row)
  }
  const link = document.createElement('a')
  link.href = googleLink(pin)
  link.target = '_blank'
  link.rel = 'noreferrer'
  link.textContent = 'Open in Google Maps'
  box.appendChild(link)
  return box
}

/**
 * A street map with a pin for each place. One pin is shown close up; several
 * are all fitted in view. The map sits in a tab that starts hidden, so it is
 * only sized and centered once its box has a real size. It fills the height
 * left on the screen, and the scroll wheel zooms it.
 */
export function PropertyMap({ pins }: { pins: MapPin[] }) {
  const box = useRef<HTMLDivElement>(null)
  const [problem, setProblem] = useState<string | null>(null)
  // Redraw only when the pins themselves change, not on every page refresh.
  const signature = pins.map((pin) => `${pin.id}:${pin.latitude},${pin.longitude}:${pin.title}:${pin.address}`).join('|')

  useEffect(() => {
    const element = box.current
    if (!element || pins.length === 0) return
    let map: LeafletMap | null = null
    let observer: ResizeObserver | null = null
    let cancelled = false
    let onResize: (() => void) | null = null

    loadLeaflet()
      .then((leaflet) => {
        if (cancelled) return
        map = leaflet.map(element, { scrollWheelZoom: true })
        leaflet.tileLayer(TILES, { maxZoom: 19, attribution: CREDIT }).addTo(map)
        const icon = leaflet.divIcon({ className: 'map-pin', html: '<span></span>', iconSize: [26, 36], iconAnchor: [13, 36], popupAnchor: [0, -32] })
        const markers = pins.map((pin) => leaflet.marker([pin.latitude, pin.longitude], { icon, title: pin.title, alt: `Pin for ${pin.title}` }).addTo(map!).bindPopup(popup(pin)))

        // The map takes the height left on the screen below where it starts, so there is no empty band under it.
        const fill = () => {
          if (element.clientWidth === 0) return
          const top = element.getBoundingClientRect().top
          // Measured from the top of the page as loaded; if the page has been scrolled, keep the height it has.
          if (top < 0) return
          element.style.height = `${Math.max(MIN_HEIGHT, Math.round(window.innerHeight - top - BOTTOM_GAP))}px`
        }
        const frame = () => {
          if (!map) return
          fill()
          map.invalidateSize()
          if (pins.length === 1) map.setView([pins[0].latitude, pins[0].longitude], ONE_PIN_ZOOM)
          else map.fitBounds(pins.map((pin) => [pin.latitude, pin.longitude] as [number, number]), { padding: [40, 40], maxZoom: ONE_PIN_ZOOM })
        }
        frame()
        // Framed again the first time the box has a real size (the tab being opened), and kept in step with resizing after that.
        let framed = element.clientWidth > 0
        if (framed && pins.length === 1) markers[0].openPopup()
        observer = new ResizeObserver(() => {
          if (!map || element.clientWidth === 0) return
          if (framed) {
            map.invalidateSize()
            return
          }
          framed = true
          frame()
          if (pins.length === 1) markers[0].openPopup()
        })
        observer.observe(element)
        onResize = () => {
          fill()
          map?.invalidateSize()
        }
        window.addEventListener('resize', onResize)
      })
      .catch((error) => {
        console.error('The map could not be shown', error)
        if (!cancelled) setProblem('The map could not be loaded. Reload the page to try again.')
      })

    return () => {
      cancelled = true
      observer?.disconnect()
      if (onResize) window.removeEventListener('resize', onResize)
      map?.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  if (problem) return <p className="form-error" role="alert">{problem}</p>
  return <div ref={box} className="property-map" role="region" aria-label="Map of this asset's addresses" />
}
