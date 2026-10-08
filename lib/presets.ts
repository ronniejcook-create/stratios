import type { BrandColors } from './theme'

/** Ready-made site color schemes. Each is a pair of brand colors; the ten site colors are built from them. */
export const SITE_PRESETS: ({ name: string } & BrandColors)[] = [
  { name: 'Midnight Amber', primary: '#14213d', accent: '#fca311' },
  { name: 'Forest', primary: '#1b4332', accent: '#52b788' },
  { name: 'Ocean', primary: '#0b3954', accent: '#00b4d8' },
  { name: 'Plum', primary: '#2d1b4e', accent: '#c77dff' },
  { name: 'Crimson', primary: '#2b0f14', accent: '#e63946' },
  { name: 'Slate Blue', primary: '#1f2933', accent: '#3ea8ff' },
  { name: 'Espresso', primary: '#2b1d14', accent: '#d4a373' },
  { name: 'Ember', primary: '#18181b', accent: '#f97316' },
]

/**
 * Ready-made graph palettes. Each order was checked so neighbouring slices,
 * including the last next to the first, stay distinguishable for normal and
 * color-blind vision.
 */
export const GRAPH_PRESETS: { name: string; colors: string[] }[] = [
  { name: 'Vivid', colors: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'] },
  { name: 'Classic', colors: ['#4e79a7', '#f28e2b', '#76b7b2', '#e15759', '#edc948', '#b07aa1', '#59a14f', '#ff9da7'] },
  { name: 'Color-blind safe', colors: ['#0072b2', '#e69f00', '#56b4e9', '#cc79a7', '#f0e442', '#009e73', '#d55e00', '#999999'] },
  { name: 'Pastel', colors: ['#5b8fd1', '#f8b08a', '#9f86d9', '#4fae8c', '#f7d774', '#ef8aa9', '#b5cf73', '#d58f5c'] },
  { name: 'Earth', colors: ['#6b4a2b', '#d9a441', '#2f7d5f', '#b8c26a', '#c25b2a', '#6aa3b8', '#8a2f2f', '#9a7bb5'] },
  { name: 'Ocean', colors: ['#1f4e79', '#2ec4b6', '#3a86ff', '#90be6d', '#0b7a75', '#f4a261', '#5e60ce', '#48cae4'] },
  { name: 'Sunset', colors: ['#e76f51', '#2a9d8f', '#f4a261', '#264653', '#e9c46a', '#9b5de5', '#d62828', '#4cc9f0'] },
  { name: 'Corporate', colors: ['#1f3a5f', '#4f86c6', '#a3b8cc', '#f2a541', '#5c6b73', '#86bbd8', '#c05746', '#2f9c95'] },
]
