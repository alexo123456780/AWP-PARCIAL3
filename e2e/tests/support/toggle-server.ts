import http from 'node:http';

/**
 * Un servidor HTTP que se puede apagar y volver a encender en el mismo puerto. Apagarlo de verdad (cierra el socket)
 * es lo más fiel al Modo Avión: `context.setOffline` no corta lo que hace el Service Worker y lo desvía.
 */
export class ToggleServer {
  private server?: http.Server;

  constructor(
    private readonly port: number,
    private readonly handler: http.RequestListener,
  ) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(this.handler);
      server.once('error', reject);
      server.listen(this.port, '127.0.0.1', () => {
        this.server = server;
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return Promise.resolve();
    // Las conexiones keep-alive del navegador mantendrían el puerto abierto: se cortan.
    server.closeAllConnections();
    return new Promise((resolve) => server.close(() => resolve()));
  }
}
