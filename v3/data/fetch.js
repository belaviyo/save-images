{
  const revokeRule = id => {
    if (id === -1) {
      return;
    }
    try {
      chrome.runtime.sendMessage({
        cmd: 'revoke-referer',
        id
      }, () => void chrome.runtime.lastError);
    }
    catch (e) {}
  };
  const requestRule = (src, referer, credentials) => new Promise(resolve => {
    let settled = false;
    const done = id => {
      const ruleId = Number.isInteger(id) ? id : -1;
      if (settled) {
        // a late worker response can still create a rule; revoke it
        if (ruleId !== -1) {
          revokeRule(ruleId);
        }
        return;
      }
      settled = true;
      resolve(ruleId);
    };

    try {
      chrome.runtime.sendMessage({
        cmd: 'apply-referer',
        src,
        referer,
        credentials
      }, done);
    }
    catch (e) {
      done(-1);
    }
    // a cold service worker can need more than a second to install the rule
    setTimeout(done, 2000, -1);
  });

  if (self.__daimagesFetchProxy !== true) {
    self.__daimagesFetchProxy = true;

    self.fetch = new Proxy(self.fetch, {
      apply(target, self, args) {
        const [src, props] = args;

        if (typeof src !== 'string' || /^https?:/i.test(src) === false) {
          return Reflect.apply(target, self, args);
        }

        const referer = props && props.headers && props.headers.referer;
        const useReferer = typeof referer === 'string' && /^https?:/i.test(referer) ? referer : '';

        /* only the collector sets a referer header explicitly. Proxying every
           fetch would rewrite the CORS headers of the host page's own requests
           (and break credentialed ones) */
        if (!useReferer) {
          return Reflect.apply(target, self, args);
        }

        return requestRule(src, useReferer, props && props.credentials).then(id => {
          let timer;

          const done = () => {
            clearTimeout(timer);
            revokeRule(id);
          };

          if (id !== -1) {
            // safety net for requests that never settle
            timer = setTimeout(done, 60 * 1000);
          }

          return Reflect.apply(target, self, args).then(r => {
            done();
            return r;
          }, e => {
            done();
            throw e;
          });
        });
      }
    });
  }
}

// eslint-disable-next-line semi
''
