{
  const port = chrome.runtime.connect({
    name: 'page'
  });
  port.onDisconnect.addListener(() => {
    try {
      window.collector.active = false;
    }
    catch (e) {}
  });
  const onMessage = request => {
    if (request.cmd === 'download-image') {
      const img = self.sources.get(request.src);

      // try to find the image on page and download it (it is useful specially if the image src is a dead blob)
      const capture = () => {
        const e = img || document.querySelector(`img[src="${request.src}"]`);

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        canvas.width = e.naturalWidth;
        canvas.height = e.naturalHeight;

        ctx.drawImage(e, 0, 0, e.naturalWidth, e.naturalHeight);
        const href = canvas.toDataURL();

        return port.postMessage({
          uid: request.uid,
          href
        });
      };

      const props = {
        headers: {
          referer: request.referer
        }
      };
      if (img && request.referer) {
        if (img.referrerPolicy) {
          if (img.referrerPolicy === 'origin') {
            try {
              props.headers.referer = (new URL(request.referer)).origin + '/';
            }
            catch (e) {}
          }
          else if (img.referrerPolicy === 'no-referrer') {
            delete props.headers.referer;
          }
        }
      }

      fetch(request.src, props).then(r => {
        if (!r.ok) {
          throw Error('STATUS_CODE_' + r.status);
        }
        return r.blob();
      }).then(blob => {
        const href = URL.createObjectURL(blob);
        port.postMessage({
          uid: request.uid,
          href
        });
      }).catch(e => {
        // try to include credentials
        props.credentials = 'include';
        fetch(request.src, props).then(r => {
          if (!r.ok) {
            throw Error('STATUS_CODE_' + r.status);
          }
          return r.blob();
        }).then(blob => {
          const href = URL.createObjectURL(blob);
          port.postMessage({
            uid: request.uid,
            href
          });
        }).catch(e => {
          try { // can we get the image from an image element
            capture();
          }
          catch (ee) {
            port.postMessage({
              uid: request.uid,
              error: e.message
            });
          }
        });
      });
    }
    else if (request.cmd === 'create-directory') {
      window.showDirectoryPicker().then(async d => {
        window.directory = d;
        if (request.readme) {
          const file = await d.getFileHandle(request.name, {
            create: true
          });
          const writable = await file.createWritable();
          const blob = new Blob([request.content], {
            type: 'text/plain'
          });
          const response = new Response(blob);
          await response.body.pipeTo(writable);
        }
        port.postMessage({
          uid: request.uid
        });
      }).catch(e => {
        port.postMessage({
          uid: request.uid,
          error: e.message
        });
      });
    }
    else if (request.cmd === 'image-to-directory') {
      Promise.all([
        fetch(request.href),
        window.directory.getFileHandle(request.filename, {
          create: true
        }).then(file => file.createWritable())
      ]).then(async ([response, writable]) => {
        try {
          await writable.truncate(0);
          await response.body.pipeTo(writable);
        }
        catch (e) {
          console.warn(e);
        }
        URL.revokeObjectURL(request.href);
      });
    }
    else if (request.cmd === 'stop-collector') {
      try {
        window.collector.active = false;
      }
      catch (e) {}
      if (request.remove) {
        for (const e of document.querySelectorAll('dialog.daimages')) {
          e.remove();
        }
        port.disconnect();
      }
    }
  };
  port.onMessage.addListener(onMessage);
  self.post = request => {
    try {
      port.postMessage(request);
    }
    catch (e) {}
  };
  self.sources = new Map();
  self.onMessage = onMessage;
}
