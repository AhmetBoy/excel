// Hovering a product image shows it large in a floating box. The FC Research
// image URL is already the full-size picture, so no extra request is made.
// Works for every product image in the lookup, associate and bin results.

const ZOOM_SCOPE = '#results-body, #user-results, #location-results, #locbar-output';
const MAX_SIZE = 320;
const MARGIN = 8;

const preview = document.createElement('div');
preview.id = 'image-zoom';
preview.hidden = true;
const previewImg = document.createElement('img');
previewImg.alt = '';
preview.appendChild(previewImg);
document.body.appendChild(preview);

let current = null;

function zoomableImage(target) {
  if (!(target instanceof HTMLImageElement) || !target.src) return null;
  return target.closest(ZOOM_SCOPE) ? target : null;
}

function place(event) {
  const size = Math.min(MAX_SIZE, window.innerWidth - 2 * MARGIN, window.innerHeight - 2 * MARGIN);
  preview.style.width = `${size}px`;
  preview.style.height = `${size}px`;
  // Right of the cursor when it fits, otherwise left; kept inside the panel.
  let left = event.clientX + 16;
  if (left + size > window.innerWidth - MARGIN) left = event.clientX - 16 - size;
  left = Math.max(MARGIN, Math.min(left, window.innerWidth - size - MARGIN));
  let top = event.clientY - size / 2;
  top = Math.max(MARGIN, Math.min(top, window.innerHeight - size - MARGIN));
  preview.style.left = `${left}px`;
  preview.style.top = `${top}px`;
}

function hide() {
  current = null;
  preview.hidden = true;
}

document.addEventListener('mouseover', (event) => {
  const img = zoomableImage(event.target);
  if (!img) return;
  current = img;
  if (previewImg.src !== img.src) previewImg.src = img.src;
  previewImg.alt = img.alt;
  place(event);
  preview.hidden = false;
});

document.addEventListener('mousemove', (event) => {
  if (current && event.target === current) place(event);
});

document.addEventListener('mouseout', (event) => {
  if (current && event.target === current) hide();
});

// A re-render (or scroll) can remove the image under the cursor.
document.addEventListener('scroll', hide, true);
window.addEventListener('blur', hide);
