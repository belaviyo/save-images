'use strict';

var ui = document.getElementById('ui');
var gallery = document.getElementById('gallery');

ui.addEventListener('load', () => ui.dataset.loading = false);
gallery.addEventListener('load', () => gallery.dataset.loading = false);

window.addEventListener('load', () => {
  ui.src = '/data/ui/index.html';
});

var to = {
  gallery: () => {
    gallery.dataset.loading = true;
    document.body.dataset.mode = 'gallery';
    gallery.src = '/data/gallery/index.html';
  },
  ui: () => {
    document.body.dataset.mode = 'ui';
    gallery.src = 'about:blank';
  }
};
