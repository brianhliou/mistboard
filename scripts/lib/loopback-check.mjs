import net from 'node:net';

// Use the same IPv4 listener/client pair as the server tests. VPNs can break
// IPv4 connections to a dual-stack wildcard listener on macOS (#741).
export function checkLoopback({ timeoutMs = 3_000 } = {}) {
  return new Promise((resolve, reject) => {
    let client;
    let accepted;
    let finished = false;
    const server = net.createServer((socket) => {
      accepted = socket;
      socket.on('error', fail);
      socket.end('ok');
    });
    const timer = setTimeout(() => fail(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);

    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      client?.destroy();
      accepted?.destroy();
      server.close();
      if (error) {
        reject(
          new Error(
            `loopback unreachable: 127.0.0.1 (${error.message}); check VPN/firewall settings before rerunning CI`,
            { cause: error },
          ),
        );
      } else {
        resolve();
      }
    }

    function fail(error) {
      finish(error);
    }

    server.once('error', fail);
    try {
      server.listen(0, '127.0.0.1', () => {
        try {
          const address = server.address();
          client = net.createConnection({ port: address.port, host: '127.0.0.1' });
          client.once('error', fail);
          client.once('data', () => finish());
          client.once('end', () => fail(new Error('connection ended before receiving data')));
        } catch (error) {
          fail(error);
        }
      });
    } catch (error) {
      fail(error);
    }
  });
}
