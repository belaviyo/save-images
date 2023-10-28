{
  const port = chrome.runtime.connect({
    name: 'page'
  });
  const onMessage = request => {
    if (request.cmd === 'download-image') {
      fetch(request.src).then(r => r.blob()).then(blob => {
        const href = URL.createObjectURL(blob);
        port.postMessage({
          uid: request.uid,
          href
        });
      }).catch(e => port.postMessage({
        uid: request.uid,
        error: e.message
      }));
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
        if (request.remove) {
          for (const e of document.querySelectorAll('dialog.daimages')) {
            e.remove();
          }
        }
      }
      catch (e) {}
    }
  };
  port.onMessage.addListener(onMessage);
  self.post = request => port.postMessage(request);
  self.onMessage = onMessage;
}
