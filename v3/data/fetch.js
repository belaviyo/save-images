{
  const ap = (src, referer, credentials) => new Promise(resolve => {
    chrome.runtime.sendMessage({
      cmd: 'apply-referer',
      src,
      referer,
      credentials
    }, resolve);
    setTimeout(resolve, 1000, -1);
  });
  const re = id => new Promise(resolve => {
    chrome.runtime.sendMessage({
      cmd: 'revoke-referer',
      id
    }, resolve);
    setTimeout(resolve, 1000, -1);
  });
  self.fetch = new Proxy(self.fetch, {
    apply(target, self, args) {
      const [src, props] = args;
      if (src && src.startsWith('http') && props && props.headers?.referer) {
        const referer = props.headers.referer;
        if (referer.startsWith('http')) {
          return ap(src, referer, props.credentials).then(id => {
            return Reflect.apply(target, self, args).then(r => {
              re(id);
              return r;
            }).catch(e => {
              re(id);

              throw e;
            });
          });
        }
      }
      return Reflect.apply(target, self, args);
    }
  });
}
