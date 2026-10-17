// The web board renderer imports its stylesheets for Vite; under Node they are
// empty modules. The board's own rules reach the page as BANQI_BOARD_CSS.
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function load(url, context, next) {
        if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
        return next(url, context);
      }`,
    ),
);
