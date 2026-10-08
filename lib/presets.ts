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
  { name: 'Monochrome', primary: '#121212', accent: '#a3a3a3' },
  { name: 'Teal', primary: '#0d2b2e', accent: '#2dd4bf' },
  { name: 'Rose', primary: '#2a1420', accent: '#fb7185' },
  { name: 'Indigo', primary: '#1e1b4b', accent: '#818cf8' },
  { name: 'Olive', primary: '#1f2414', accent: '#b5c45a' },
  { name: 'Sand', primary: '#2b2620', accent: '#e9c46a' },
  { name: 'Navy & Red', primary: '#0b1f3a', accent: '#ef4444' },
  { name: 'Lime', primary: '#14201a', accent: '#84cc16' },
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
  // Single-family palettes: shades of one color, ordered so dark and light
  // shades alternate and neighbouring slices differ as much as possible.
  // Shades of one color are harder to tell apart than different colors, so
  // these suit charts with only a few series best.
  { name: 'Reds', colors: ['#6d031c', '#cb4747', '#fdac9f', '#ac3037', '#fdcec4', '#e5635b', '#8d1728', '#fe8072'] },
  { name: 'Greens', colors: ['#024505', '#40aa62', '#065e17', '#5cc480', '#12772d', '#79dd9f', '#249145', '#91f4ba'] },
  { name: 'Blues', colors: ['#003a64', '#317bcf', '#a2c5ff', '#004f8a', '#75acfd', '#1164b0', '#c9dcfc', '#5293e9'] },
  { name: 'Purples', colors: ['#3d2472', '#8763c5', '#d5b2fe', '#6d4ea8', '#e6d0fd', '#a27bdc', '#54398d', '#bc94f2'] },
  { name: 'Oranges', colors: ['#5c2602', '#b95e07', '#fed1aa', '#d77518', '#7a3705', '#ee9140', '#994a07', '#ffb06e'] },
  { name: 'Teals', colors: ['#03413d', '#21a6a7', '#0e5955', '#4ebec2', '#0b726f', '#71d7dc', '#038c8b', '#8eedf4'] },
  { name: 'Greys', colors: ['#34383d', '#8e9299', '#494d53', '#a7abb2', '#5f646a', '#c1c4cb', '#767b82', '#d8dbe1'] },
]
