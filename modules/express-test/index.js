// aperium_modules/express-test/index.js

const path = require('path');
const url = require('url');

// This function simulates the behavior of the real Express module.
// It returns a mock application object with `get` and `listen` methods.
const createMockApp = () => {
    const routes = {};

    const app = {
        // Simulates the `app.get()` method for defining a GET route.
        get: (routePath, handler) => {
            routes[routePath] = handler;
        },

        // Simulates the `app.listen()` method to start the server.
        listen: (port, callback) => {
            console.log(`Express-test server started on port: ${port}`);
            
            // In a real server, this would not block.
            // We immediately call the callback to match the non-blocking behavior.
            if (callback) {
                callback();
            }

            // A mock request handler to demonstrate the route.
            console.log("--- Simulating a request to the '/' route ---");
            const mockReq = { method: 'GET', url: '/' };
            const mockRes = {
                send: (message) => {
                    console.log(`Response from server: "${message}"`);
                }
            };

            const handler = routes['/'];
            if (handler) {
                handler(mockReq, mockRes);
            }
            console.log("----------------------------------------------");
        }
    };

    return app;
};

// Export the factory function, as is standard with Express.
module.exports = createMockApp;
