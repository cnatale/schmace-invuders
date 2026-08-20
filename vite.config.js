import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    {
      name: 'imu-debug-capture',
      configureServer(server) {
        server.middlewares.use('/__imu_capture', (request, response, next) => {
          if (request.method !== 'POST') {
            next();
            return;
          }

          let body = '';
          request.setEncoding('utf8');
          request.on('data', (chunk) => {
            body += chunk;
          });
          request.on('end', () => {
            console.log(`[Schmace IMU capture] ${body}`);
            response.statusCode = 204;
            response.end();
          });
        });
      },
    },
  ],
});
