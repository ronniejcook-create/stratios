PDF.js (pdfjs-dist 6.2.108, legacy build), copied here unchanged apart from the
file extension (.mjs -> .js). Apache License 2.0, see LICENSE.

The browser loads these files directly to draw a page of a PDF as a picture
(lib/pagePictures.ts). They are served as plain files and are not part of the
app's own bundle, so they are not listed in package.json.
