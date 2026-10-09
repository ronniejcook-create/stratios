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
  { name: 'Jewel Tones', colors: ['#1f6fb2', '#c9a227', '#0f8a5f', '#d4579a', '#6a4c9c', '#b3264b', '#2aa3a8', '#e07a2e'] },
  { name: 'Calm', colors: ['#466d9a', '#e0b070', '#5a9474', '#a49ad8', '#b35a72', '#4fa3ad', '#7a5a40', '#c9c27a'] },
  { name: 'Bold', colors: ['#0057e7', '#ff8c00', '#7b2cbf', '#00a86b', '#ffd60a', '#e6194b', '#00b4d8', '#c2185b'] },
  { name: 'Retro', colors: ['#d9822b', '#2f6f73', '#a63d40', '#6c8e3a', '#e3b23c', '#d16b86', '#3b5b92', '#8c5e3c'] },
  { name: 'Nordic', colors: ['#4c6a92', '#a3be8c', '#bf616a', '#88c0d0', '#d08770', '#5e81ac', '#ebcb8b', '#b48ead'] },
  { name: 'Tropical', colors: ['#ff6b6b', '#ffd166', '#1a936f', '#06d6a0', '#ef476f', '#118ab2', '#f78c6b', '#8338ec'] },
  { name: 'Finance', colors: ['#1d3557', '#2a9d8f', '#e9c46a', '#6c757d', '#90be6d', '#457b9d', '#a8dadc', '#b5651d'] },
  // One color each, in eight shades. The first five run from darkest to lightest in even steps (the shading
  // the stack plan uses for lease end years); the last three are the shades in between. The Blues came first;
  // the others follow the same steps of lightness and strength in their own hue. A single color reads best
  // where order matters (sooner to later); in a pie, neighbouring slices are closer than in the other palettes.
  { name: 'Blues', colors: ['#184076', '#1c5cab', '#3987e5', '#86b6ef', '#c0daf9', '#5f9fe9', '#2a71c8', '#a9cdf5'] },
  { name: 'Reds', colors: ['#6d2621', '#9e342e', '#d7584f', '#ea9a91', '#f7cbc5', '#e07a70', '#ba463e', '#f3b9b1'] },
  { name: 'Oranges', colors: ['#672f00', '#924500', '#cf6503', '#e4a178', '#f3ceb8', '#d9834b', '#af5504', '#eebda1'] },
  { name: 'Golds', colors: ['#543d00', '#775800', '#aa7f01', '#cdae6c', '#e6d5b3', '#be9534', '#906b01', '#ddc799'] },
  { name: 'Greens', colors: ['#094f1e', '#03712b', '#2ba04a', '#87c48f', '#c1e1c4', '#5fb16d', '#148839', '#acd6b1'] },
  { name: 'Teals', colors: ['#034b4b', '#016b6c', '#079a9a', '#5dc6c5', '#b0e2e1', '#00b2b2', '#008283', '#94d8d7'] },
  { name: 'Purples', colors: ['#4a326f', '#6b46a0', '#976cd8', '#bca4e7', '#dcd0f4', '#a888df', '#8058bc', '#d0c0f0'] },
  { name: 'Pinks', colors: ['#682547', '#963366', '#cc5791', '#e399b9', '#f3cada', '#d778a4', '#b1447b', '#edb7ce'] },
  { name: 'Greys', colors: ['#414141', '#5d5d5d', '#878787', '#b2b2b2', '#d7d7d7', '#9c9c9c', '#727272', '#c9c9c9'] },
  // One basic color in four shades, mixed with black and greys; ordered so
  // neighbouring slices differ as much as possible.
  { name: 'Red & Greys', colors: ['#d73431', '#1b1b1b', '#808080', '#febab2', '#94020d', '#fd7468', '#484848', '#bebebe'] },
  { name: 'Green & Greys', colors: ['#1d9330', '#1b1b1b', '#808080', '#a4e0a5', '#045e17', '#54bf5c', '#484848', '#bebebe'] },
  { name: 'Blue & Greys', colors: ['#2279dc', '#1b1b1b', '#808080', '#afd1fd', '#044b94', '#62a7fd', '#484848', '#bebebe'] },
  { name: 'Orange & Greys', colors: ['#be5a0a', '#1b1b1b', '#808080', '#fdbd9a', '#7b3702', '#fa7c20', '#484848', '#bebebe'] },
  { name: 'Purple & Greys', colors: ['#8c5ad3', '#d6c2fd', '#808080', '#1b1b1b', '#5f279e', '#b688fe', '#484848', '#bebebe'] },
  { name: 'Teal & Greys', colors: ['#158b8c', '#1b1b1b', '#808080', '#95dddc', '#055959', '#16bbbc', '#484848', '#bebebe'] },
  { name: 'Gold & Greys', colors: ['#95760d', '#1b1b1b', '#808080', '#e5cc89', '#5f4a02', '#c89f0d', '#484848', '#bebebe'] },
  { name: 'Pink & Greys', colors: ['#c04688', '#1b1b1b', '#808080', '#ffb4d7', '#8a085a', '#f072b3', '#484848', '#bebebe'] },
]
