/* テストのときだけ、Workers にしかない 'cloudflare:email' を偽物に差し替える。
   使い方: node --import ./test/register.mjs --test test/ */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:email') {
      return { url: new URL('./stub-cloudflare-email.mjs', import.meta.url).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
