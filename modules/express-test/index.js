// aperium_modules/express-test/index.js

const http = require('http');

// A simple routing system to mimic Express's app.get()
const createExpressLikeApp = () => {
    const routes = {};

    const app = {
        get: (routePath, handler) => {
            routes[routePath] = handler;
        },

        listen: (port, callback) => {
            const server = http.createServer((req, res) => {
                const handler = routes[req.url];
                if (handler) {
                    res.send = (message) => {
                        res.writeHead(200, { 'Content-Type': 'text/plain' });
                        res.end(message);
                    };
                    handler(req, res);
                } else {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('404 Not Found');
                }
            });

            server.listen(port, callback);
        }
    };

    return app;
};

module.exports = createExpressLikeApp;
